import type { PublicClient } from 'viem';
import { roundManagerAbi } from '../abi/roundManager';
import { predictionArenaAbi } from '../abi/predictionArena';
import { agentRegistryAbi } from '../abi/agentRegistry';
import type { Round, AgentRoundData, AgentInfo } from '../types';
import type { ContractAddresses } from '../config/contracts';

// ---------------------------------------------------------------------------
// Serialization helpers (Maps are not JSON-safe)
// ---------------------------------------------------------------------------

export function serializeRounds(rounds: Round[]): any {
  return rounds.map((r) => ({
    ...r,
    agents: Array.from(r.agents.entries()),
  }));
}

export function deserializeRounds(data: any): Round[] {
  return (data as any[]).map((r) => ({
    ...r,
    agents: new Map<string, AgentRoundData>(r.agents),
  }));
}

export function serializeAgents(agents: Map<string, AgentInfo>): any {
  return Array.from(agents.entries());
}

export function deserializeAgents(data: any): Map<string, AgentInfo> {
  return new Map<string, AgentInfo>(data as [string, AgentInfo][]);
}

// ---------------------------------------------------------------------------
// Chunked log fetching (works with restrictive RPCs like Alchemy free tier)
// ---------------------------------------------------------------------------

const CHUNK_SIZE = 1000n; // blocks per request; dRPC free tier allows max 1000

async function getContractEventsChunked<TAbi extends readonly unknown[]>(
  client: PublicClient,
  params: {
    address: `0x${string}`;
    abi: TAbi;
    eventName: string;
    fromBlock: bigint;
    toBlock: bigint;
  },
): Promise<any[]> {
  const { fromBlock, toBlock, ...rest } = params;
  const latestBlock = toBlock === BigInt(0)
    ? await client.getBlockNumber()
    : toBlock;

  let chunkSize = CHUNK_SIZE;
  let cursor = fromBlock;
  const allEvents: any[] = [];

  while (cursor <= latestBlock) {
    const end = cursor + chunkSize - 1n > latestBlock ? latestBlock : cursor + chunkSize - 1n;
    try {
      const events = await client.getContractEvents({
        ...rest,
        fromBlock: cursor,
        toBlock: end,
      } as any);
      allEvents.push(...events);
      cursor = end + 1n;
    } catch (e: any) {
      const msg = e?.message || e?.toString() || '';
      // If range too large, halve the chunk size
      if (msg.includes('block range') || msg.includes('Log response size exceeded') || msg.includes('10 block range')) {
        chunkSize = chunkSize > 10n ? chunkSize / 2n : 10n;
        if (chunkSize <= 10n) {
          // Absolute minimum — try 10 blocks at a time
          chunkSize = 10n;
        }
        continue; // retry with smaller chunk
      }
      throw e;
    }
  }
  return allEvents;
}

// ---------------------------------------------------------------------------
// Core event fetching
// ---------------------------------------------------------------------------

function emptyAgentRoundData(address: string): AgentRoundData {
  return {
    address,
    commitHash: '',
    commitTimestamp: 0,
    revealed: false,
    predictions: [],
    brierScore: 0,
    alphaScore: 0,
    scoredMarkets: 0,
    totalMarkets: 0,
  };
}

export async function fetchAllEvents(
  client: PublicClient,
  addresses: ContractAddresses,
): Promise<{ rounds: Round[]; agents: Map<string, AgentInfo>; lastBlock: number }> {
  const fromBlock = addresses.deployBlock;

  // ------ Fetch all event types in parallel (chunked for restrictive RPCs) ------
  const latestBlock = await client.getBlockNumber();
  const fetchEvents = (address: `0x${string}`, abi: any, eventName: string) =>
    getContractEventsChunked(client, { address, abi, eventName, fromBlock, toBlock: latestBlock });

  // Fetch sequentially to avoid rate limiting on free-tier RPCs
  const roundCreatedEvents = await fetchEvents(addresses.roundManager, roundManagerAbi, 'RoundCreated');
  const benchmarksPostedEvents = await fetchEvents(addresses.roundManager, roundManagerAbi, 'BenchmarksPosted');
  const roundInvalidatedEvents = await fetchEvents(addresses.roundManager, roundManagerAbi, 'RoundInvalidated');
  const committedEvents = await fetchEvents(addresses.predictionArena, predictionArenaAbi, 'Committed');
  const revealedEvents = await fetchEvents(addresses.predictionArena, predictionArenaAbi, 'Revealed');
  const scoreComputedEvents = await fetchEvents(addresses.predictionArena, predictionArenaAbi, 'ScoreComputed');
  const agentRegisteredEvents = await fetchEvents(addresses.agentRegistry, agentRegistryAbi, 'AgentRegistered');
  const agentUpdatedEvents = await fetchEvents(addresses.agentRegistry, agentRegistryAbi, 'AgentUpdated');

  // ------ Track the highest block number seen ------
  let lastBlock = Number(fromBlock);
  function trackBlock(blockNumber: bigint | undefined) {
    if (blockNumber != null) {
      const n = Number(blockNumber);
      if (n > lastBlock) lastBlock = n;
    }
  }

  // ------ Build rounds map ------
  const roundsMap = new Map<number, Round>();

  for (const event of roundCreatedEvents) {
    trackBlock(event.blockNumber ?? undefined);
    const args = event.args as {
      roundId: bigint;
      conditionIds: readonly `0x${string}`[];
      commitDeadline: bigint;
      revealDeadline: bigint;
    };
    const roundId = Number(args.roundId);
    roundsMap.set(roundId, {
      roundId,
      conditionIds: [...args.conditionIds],
      benchmarkPrices: [],
      commitDeadline: Number(args.commitDeadline),
      revealStart: 0, // not in event; will be between commitDeadline and revealDeadline
      revealDeadline: Number(args.revealDeadline),
      outcomes: [],
      benchmarksPosted: false,
      invalidated: false,
      agents: new Map<string, AgentRoundData>(),
    });
  }

  for (const event of benchmarksPostedEvents) {
    trackBlock(event.blockNumber ?? undefined);
    const args = event.args as { roundId: bigint; benchmarkPrices: readonly number[] };
    const round = roundsMap.get(Number(args.roundId));
    if (round) {
      round.benchmarkPrices = [...args.benchmarkPrices];
      round.benchmarksPosted = true;
    }
  }

  for (const event of roundInvalidatedEvents) {
    trackBlock(event.blockNumber ?? undefined);
    const args = event.args as { roundId: bigint };
    const round = roundsMap.get(Number(args.roundId));
    if (round) {
      round.invalidated = true;
    }
  }

  // ------ Block timestamp cache for commit events ------
  const blockTimestampCache = new Map<bigint, number>();

  async function getBlockTimestamp(blockNumber: bigint): Promise<number> {
    const cached = blockTimestampCache.get(blockNumber);
    if (cached !== undefined) return cached;
    const block = await client.getBlock({ blockNumber });
    const ts = Number(block.timestamp);
    blockTimestampCache.set(blockNumber, ts);
    return ts;
  }

  // ------ Process Committed events ------
  // Collect unique block numbers first so we can batch-fetch timestamps
  const commitBlockNumbers = new Set<bigint>();
  for (const event of committedEvents) {
    if (event.blockNumber != null) commitBlockNumbers.add(event.blockNumber);
  }
  // Pre-fetch all needed block timestamps in parallel
  await Promise.all(
    Array.from(commitBlockNumbers).map((bn) => getBlockTimestamp(bn)),
  );

  for (const event of committedEvents) {
    trackBlock(event.blockNumber ?? undefined);
    const args = event.args as { roundId: bigint; agent: `0x${string}`; commitHash: `0x${string}` };
    const round = roundsMap.get(Number(args.roundId));
    if (!round) continue;

    const agentAddr = args.agent.toLowerCase();
    let agentData = round.agents.get(agentAddr);
    if (!agentData) {
      agentData = emptyAgentRoundData(agentAddr);
      round.agents.set(agentAddr, agentData);
    }
    agentData.commitHash = args.commitHash;
    if (event.blockNumber != null) {
      agentData.commitTimestamp = blockTimestampCache.get(event.blockNumber) ?? 0;
    }
  }

  // ------ Process Revealed events ------
  for (const event of revealedEvents) {
    trackBlock(event.blockNumber ?? undefined);
    const args = event.args as {
      roundId: bigint;
      agent: `0x${string}`;
      predictions: readonly number[];
      scoredMarkets: number;
    };
    const round = roundsMap.get(Number(args.roundId));
    if (!round) continue;

    const agentAddr = args.agent.toLowerCase();
    let agentData = round.agents.get(agentAddr);
    if (!agentData) {
      agentData = emptyAgentRoundData(agentAddr);
      round.agents.set(agentAddr, agentData);
    }
    agentData.revealed = true;
    agentData.predictions = [...args.predictions];
    agentData.scoredMarkets = args.scoredMarkets;
  }

  // ------ Process ScoreComputed events ------
  for (const event of scoreComputedEvents) {
    trackBlock(event.blockNumber ?? undefined);
    const args = event.args as {
      roundId: bigint;
      agent: `0x${string}`;
      brierScore: bigint;
      alphaScore: bigint;
      scoredMarkets: number;
    };
    const round = roundsMap.get(Number(args.roundId));
    if (!round) continue;

    const agentAddr = args.agent.toLowerCase();
    let agentData = round.agents.get(agentAddr);
    if (!agentData) {
      agentData = emptyAgentRoundData(agentAddr);
      round.agents.set(agentAddr, agentData);
    }
    agentData.brierScore = Number(args.brierScore);
    agentData.alphaScore = Number(args.alphaScore);
    agentData.scoredMarkets = args.scoredMarkets;
    agentData.totalMarkets = round.conditionIds.length;
  }

  // ------ Build agents map ------
  const agents = new Map<string, AgentInfo>();

  for (const event of agentRegisteredEvents) {
    trackBlock(event.blockNumber ?? undefined);
    const args = event.args as {
      agent: `0x${string}`;
      name: string;
      url: string;
      owner: `0x${string}`;
    };
    const addr = args.agent.toLowerCase();
    agents.set(addr, {
      address: addr,
      name: args.name,
      url: args.url,
      owner: args.owner.toLowerCase(),
      registeredAt: 0, // not in event; could be derived from block timestamp if needed
    });
  }

  for (const event of agentUpdatedEvents) {
    trackBlock(event.blockNumber ?? undefined);
    const args = event.args as {
      agent: `0x${string}`;
      name: string;
      url: string;
      owner: `0x${string}`;
    };
    const addr = args.agent.toLowerCase();
    const existing = agents.get(addr);
    agents.set(addr, {
      address: addr,
      name: args.name,
      url: args.url,
      owner: args.owner.toLowerCase(),
      registeredAt: existing?.registeredAt ?? 0,
    });
  }

  // ------ Sort rounds descending by roundId ------
  const rounds = Array.from(roundsMap.values()).sort((a, b) => b.roundId - a.roundId);

  return { rounds, agents, lastBlock };
}
