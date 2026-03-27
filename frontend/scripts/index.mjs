#!/usr/bin/env node
/**
 * Foresight Arena Indexer
 * Fetches on-chain events and writes a static JSON file for the frontend.
 *
 * Usage:
 *   node indexer/index.mjs [--rpc URL] [--out PATH] [--set fast|production]
 *
 * Environment:
 *   RPC_URL — Polygon RPC endpoint (default: https://polygon-rpc.com)
 */

import { createPublicClient, http, parseAbiItem } from 'viem';
import { polygon } from 'viem/chains';
import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------- Contract config ----------

const CONTRACT_SETS = {
  fast: {
    roundManager: '0xa2303C1FbFD8dD556355eE9E33Bb899759907d78',
    predictionArena: '0x5D0aFAb396CA23d25e2Bd703c9736aC095be8eB6',
    agentRegistry: '0x669734f7f6dd2a5616fE910e172366B267DfCF7E',
    gasRebate: '0xaF97f527a9D324bBe891C3814a3160296fAdaB00',
    deployBlock: 84710000n,
  },
  production: {
    roundManager: '0x0000000000000000000000000000000000000000',
    predictionArena: '0x0000000000000000000000000000000000000000',
    agentRegistry: '0x0000000000000000000000000000000000000000',
    gasRebate: '0x0000000000000000000000000000000000000000',
    deployBlock: 0n,
  },
};

// ---------- Event ABIs ----------

const EVENTS = {
  RoundCreated: parseAbiItem('event RoundCreated(uint256 indexed roundId, bytes32[] conditionIds, uint64 commitDeadline, uint64 revealDeadline)'),
  BenchmarksPosted: parseAbiItem('event BenchmarksPosted(uint256 indexed roundId, uint16[] benchmarkPrices)'),
  RoundInvalidated: parseAbiItem('event RoundInvalidated(uint256 indexed roundId)'),
  Committed: parseAbiItem('event Committed(uint256 indexed roundId, address indexed agent, bytes32 commitHash)'),
  Revealed: parseAbiItem('event Revealed(uint256 indexed roundId, address indexed agent, uint16[] predictions, uint16 scoredMarkets)'),
  ScoreComputed: parseAbiItem('event ScoreComputed(uint256 indexed roundId, address indexed agent, uint256 brierScore, int256 alphaScore, uint16 scoredMarkets)'),
  AgentRegistered: parseAbiItem('event AgentRegistered(address indexed agent, string name, string url, address owner)'),
  AgentUpdated: parseAbiItem('event AgentUpdated(address indexed agent, string name, string url, address owner)'),
};

// ---------- Chunked log fetching ----------

async function fetchLogs(client, address, event, fromBlock, toBlock) {
  const CHUNK = 50000n; // most paid RPCs handle this; free RPCs will auto-reduce
  let cursor = fromBlock;
  let chunkSize = CHUNK;
  const all = [];

  while (cursor <= toBlock) {
    const end = cursor + chunkSize - 1n > toBlock ? toBlock : cursor + chunkSize - 1n;
    try {
      const logs = await client.getLogs({
        address,
        event,
        fromBlock: cursor,
        toBlock: end,
      });
      all.push(...logs);
      cursor = end + 1n;
    } catch (e) {
      const msg = e?.message || '';
      if (msg.includes('block range') || msg.includes('10 block range') || msg.includes('10000 block')) {
        chunkSize = chunkSize > 100n ? chunkSize / 2n : 100n;
        continue;
      }
      throw e;
    }
  }
  return all;
}

// ---------- Main ----------

async function main() {
  const args = process.argv.slice(2);
  const getArg = (flag, def) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? args[i + 1] : def;
  };

  const rpcUrl = getArg('--rpc', process.env.RPC_URL || 'https://polygon-rpc.com');
  const setName = getArg('--set', 'fast');
  const outPath = getArg('--out', resolve(__dirname, '..', 'public', 'data.json'));

  const addresses = CONTRACT_SETS[setName];
  if (!addresses) {
    console.error(`Unknown contract set: ${setName}`);
    process.exit(1);
  }

  console.log(`Indexing "${setName}" contracts via ${rpcUrl}`);
  console.log(`Deploy block: ${addresses.deployBlock}`);

  const client = createPublicClient({
    chain: polygon,
    transport: http(rpcUrl),
  });

  const latestBlock = await client.getBlockNumber();
  console.log(`Latest block: ${latestBlock} (range: ${latestBlock - addresses.deployBlock} blocks)`);

  const fetchEvt = (addr, event) => fetchLogs(client, addr, event, addresses.deployBlock, latestBlock);

  // Fetch all events sequentially
  console.log('Fetching RoundCreated...');
  const roundCreated = await fetchEvt(addresses.roundManager, EVENTS.RoundCreated);
  console.log(`  ${roundCreated.length} events`);

  console.log('Fetching BenchmarksPosted...');
  const benchmarksPosted = await fetchEvt(addresses.roundManager, EVENTS.BenchmarksPosted);
  console.log(`  ${benchmarksPosted.length} events`);

  console.log('Fetching RoundInvalidated...');
  const roundInvalidated = await fetchEvt(addresses.roundManager, EVENTS.RoundInvalidated);
  console.log(`  ${roundInvalidated.length} events`);

  console.log('Fetching Committed...');
  const committed = await fetchEvt(addresses.predictionArena, EVENTS.Committed);
  console.log(`  ${committed.length} events`);

  console.log('Fetching Revealed...');
  const revealed = await fetchEvt(addresses.predictionArena, EVENTS.Revealed);
  console.log(`  ${revealed.length} events`);

  console.log('Fetching ScoreComputed...');
  const scoreComputed = await fetchEvt(addresses.predictionArena, EVENTS.ScoreComputed);
  console.log(`  ${scoreComputed.length} events`);

  console.log('Fetching AgentRegistered...');
  const agentRegistered = await fetchEvt(addresses.agentRegistry, EVENTS.AgentRegistered);
  console.log(`  ${agentRegistered.length} events`);

  console.log('Fetching AgentUpdated...');
  const agentUpdated = await fetchEvt(addresses.agentRegistry, EVENTS.AgentUpdated);
  console.log(`  ${agentUpdated.length} events`);

  // ---------- Build data structures ----------

  // Rounds
  const rounds = {};
  for (const log of roundCreated) {
    const { roundId, conditionIds, commitDeadline, revealDeadline } = log.args;
    rounds[Number(roundId)] = {
      roundId: Number(roundId),
      conditionIds: [...conditionIds],
      benchmarkPrices: [],
      commitDeadline: Number(commitDeadline),
      revealStart: Number(commitDeadline), // FastRoundManager: revealStart = commitDeadline
      revealDeadline: Number(revealDeadline),
      benchmarksPosted: false,
      invalidated: false,
      agents: {},
    };
  }

  for (const log of benchmarksPosted) {
    const { roundId, benchmarkPrices } = log.args;
    const round = rounds[Number(roundId)];
    if (round) {
      round.benchmarkPrices = benchmarkPrices.map(Number);
      round.benchmarksPosted = true;
    }
  }

  for (const log of roundInvalidated) {
    const round = rounds[Number(log.args.roundId)];
    if (round) round.invalidated = true;
  }

  // ---------- Fetch market outcomes from CTF contract ----------
  const CTF_ADDRESS = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';
  const allConditionIds = new Set();
  for (const round of Object.values(rounds)) {
    for (const cid of round.conditionIds) allConditionIds.add(cid);
  }

  const outcomes = {}; // conditionId -> 'YES' | 'NO' | null
  console.log(`Reading CTF outcomes for ${allConditionIds.size} markets...`);
  for (const cid of allConditionIds) {
    try {
      const denom = await client.readContract({
        address: CTF_ADDRESS,
        abi: [{ type: 'function', name: 'payoutDenominator', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' }],
        functionName: 'payoutDenominator',
        args: [cid],
      });
      if (denom > 0n) {
        const payout0 = await client.readContract({
          address: CTF_ADDRESS,
          abi: [{ type: 'function', name: 'payoutNumerators', inputs: [{ type: 'bytes32' }, { type: 'uint256' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' }],
          functionName: 'payoutNumerators',
          args: [cid, 0n],
        });
        outcomes[cid] = payout0 > 0n ? 'YES' : 'NO';
      } else {
        outcomes[cid] = null;
      }
    } catch {
      outcomes[cid] = null;
    }
  }
  console.log(`  Resolved: ${Object.values(outcomes).filter(v => v !== null).length}/${allConditionIds.size}`);

  // Attach outcomes to rounds
  for (const round of Object.values(rounds)) {
    round.outcomes = round.conditionIds.map(cid => outcomes[cid] || null);
  }

  // Block timestamps for commits
  const blockTimestamps = {};
  const uniqueBlocks = new Set(committed.map(l => l.blockNumber));
  for (const bn of uniqueBlocks) {
    const block = await client.getBlock({ blockNumber: bn });
    blockTimestamps[bn.toString()] = Number(block.timestamp);
  }

  // Committed
  for (const log of committed) {
    const { roundId, agent, commitHash } = log.args;
    const round = rounds[Number(roundId)];
    if (!round) continue;
    const addr = agent.toLowerCase();
    round.agents[addr] = {
      address: addr,
      commitHash,
      commitTimestamp: blockTimestamps[log.blockNumber.toString()] || 0,
      revealed: false,
      predictions: [],
      brierScore: 0,
      alphaScore: 0,
      scoredMarkets: 0,
      totalMarkets: 0,
    };
  }

  // Revealed
  for (const log of revealed) {
    const { roundId, agent, predictions, scoredMarkets } = log.args;
    const round = rounds[Number(roundId)];
    if (!round) continue;
    const addr = agent.toLowerCase();
    if (!round.agents[addr]) continue;
    round.agents[addr].revealed = true;
    round.agents[addr].predictions = predictions.map(Number);
    round.agents[addr].scoredMarkets = Number(scoredMarkets);
  }

  // ScoreComputed
  for (const log of scoreComputed) {
    const { roundId, agent, brierScore, alphaScore, scoredMarkets } = log.args;
    const round = rounds[Number(roundId)];
    if (!round) continue;
    const addr = agent.toLowerCase();
    if (!round.agents[addr]) continue;
    round.agents[addr].brierScore = Number(brierScore);
    round.agents[addr].alphaScore = Number(alphaScore);
    round.agents[addr].scoredMarkets = Number(scoredMarkets);
    round.agents[addr].totalMarkets = round.conditionIds.length;
  }

  // Agents registry
  const agents = {};
  for (const log of agentRegistered) {
    const { agent, name, url, owner } = log.args;
    const addr = agent.toLowerCase();
    agents[addr] = { address: addr, name, url, owner: owner.toLowerCase(), registeredAt: 0 };
  }
  for (const log of agentUpdated) {
    const { agent, name, url, owner } = log.args;
    const addr = agent.toLowerCase();
    agents[addr] = { ...agents[addr], address: addr, name, url, owner: owner.toLowerCase() };
  }

  // Convert rounds to sorted array, agents map to array
  const roundsArray = Object.values(rounds)
    .sort((a, b) => b.roundId - a.roundId)
    .map(r => ({
      ...r,
      agents: Object.values(r.agents),
    }));

  const agentsArray = Object.values(agents);

  const output = {
    contractSet: setName,
    indexedAt: Math.floor(Date.now() / 1000),
    latestBlock: Number(latestBlock),
    rounds: roundsArray,
    agents: agentsArray,
  };

  writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\nWrote ${outPath}`);
  console.log(`  ${roundsArray.length} rounds, ${agentsArray.length} registered agents`);
  console.log(`  Indexed at block ${latestBlock}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
