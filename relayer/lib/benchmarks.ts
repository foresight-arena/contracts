import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  type Chain,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { polygon } from 'viem/chains';

const SUBGRAPH = 'https://api.studio.thegraph.com/query/1745354/foresight-arena/version/latest';

const roundManagerAbi = parseAbi([
  'function postBenchmarkPrices(uint256 roundId, uint16[] benchmarkPrices) external',
]);

const arenaAbi = parseAbi([
  'function triggerOutcomesAndScore(uint256 roundId) external',
  'function getRoundOutcomes(uint256 roundId) view returns (bool triggered, uint256 bitmask, int256[] outcomes)',
  'function getPendingScoringCount(uint256 roundId) view returns (uint256 total, uint256 processed)',
  'function calculateScoresForPendingReveals(uint256 roundId, uint256 batchSize) external',
]);

const ctfAbi = parseAbi([
  'function payoutDenominator(bytes32 conditionId) view returns (uint256)',
]);

interface SubgraphRound {
  roundId: string;
  conditionIds: string[];
  commitDeadline: string;
  benchmarksPosted: boolean;
  invalidated: boolean;
}

interface PriceHistoryPoint {
  t: number;
  p: number;
}

async function querySubgraph(query: string): Promise<any> {
  const resp = await fetch(SUBGRAPH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const json = await resp.json();
  return json.data;
}

async function getTokenId(conditionId: string): Promise<string | null> {
  try {
    const resp = await fetch(
      `https://gamma-api.polymarket.com/markets?condition_ids=${conditionId}`
    );
    if (!resp.ok) return null;
    const markets = await resp.json();
    if (!Array.isArray(markets) || markets.length === 0) return null;
    const m = markets[0];
    // clobTokenIds is a JSON string like '["123...", "456..."]'
    let tokenIds = m.clobTokenIds;
    if (typeof tokenIds === 'string') {
      try { tokenIds = JSON.parse(tokenIds); } catch { return null; }
    }
    if (Array.isArray(tokenIds) && tokenIds.length > 0) return tokenIds[0];
    return null;
  } catch {
    return null;
  }
}

async function getPriceAtTimestamp(
  tokenId: string,
  timestamp: number,
): Promise<number | null> {
  try {
    // Fetch price history around the commit deadline
    const startTs = timestamp - 300; // 5 min before
    const endTs = timestamp + 300;   // 5 min after
    const resp = await fetch(
      `https://clob.polymarket.com/prices-history?market=${tokenId}&startTs=${startTs}&endTs=${endTs}&fidelity=1`
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    const history: PriceHistoryPoint[] = data.history || [];
    if (history.length === 0) return null;

    // Find the closest price to the commit deadline
    let closest = history[0];
    let minDiff = Math.abs(closest.t - timestamp);
    for (const point of history) {
      const diff = Math.abs(point.t - timestamp);
      if (diff < minDiff) {
        minDiff = diff;
        closest = point;
      }
    }
    return closest.p;
  } catch {
    return null;
  }
}

export async function checkAndPostBenchmarks(): Promise<string[]> {
  const results: string[] = [];

  // Find rounds that need benchmarks
  const now = Math.floor(Date.now() / 1000);
  const data = await querySubgraph(`{
    rounds(where: { benchmarksPosted: false, invalidated: false }) {
      roundId
      conditionIds
      commitDeadline
      benchmarksPosted
      invalidated
    }
  }`);

  const rounds: SubgraphRound[] = data?.rounds || [];
  const pendingRounds = rounds.filter(
    (r) => Number(r.commitDeadline) < now && !r.benchmarksPosted && !r.invalidated
  );

  if (pendingRounds.length === 0) {
    results.push('No rounds need benchmarks');
    return results;
  }

  const rpcUrl = process.env.RPC_URL || 'https://polygon-rpc.com';
  const curatorKey = process.env.CURATOR_PRIVATE_KEY || process.env.RELAYER_PRIVATE_KEY;
  if (!curatorKey) {
    results.push('ERROR: No CURATOR_PRIVATE_KEY or RELAYER_PRIVATE_KEY set');
    return results;
  }

  const roundManagerAddress = (process.env.ROUND_MANAGER_ADDRESS || '0x033C47EdE0030aDf72a4ea6B6B32DC4Bf60d2B5c') as `0x${string}`;
  const account = privateKeyToAccount(curatorKey as `0x${string}`);

  const client = createPublicClient({
    chain: polygon as Chain,
    transport: http(rpcUrl),
  });

  const wallet = createWalletClient({
    account,
    chain: polygon as Chain,
    transport: http(rpcUrl),
  });

  for (const round of pendingRounds) {
    const roundId = Number(round.roundId);
    const commitDeadline = Number(round.commitDeadline);
    results.push(`Processing round ${roundId} (commit deadline: ${new Date(commitDeadline * 1000).toISOString()})`);

    const prices: number[] = [];
    let allPricesFound = true;

    for (const cid of round.conditionIds) {
      // Get token ID from Polymarket
      const tokenId = await getTokenId(cid);
      if (!tokenId) {
        results.push(`  WARNING: No token ID found for ${cid.slice(0, 10)}...`);
        // Use 5000 (50%) as fallback
        prices.push(5000);
        continue;
      }

      // Get price at commit deadline
      const price = await getPriceAtTimestamp(tokenId, commitDeadline);
      if (price !== null) {
        // Convert from 0-1 float to basis points (0-10000)
        const bps = Math.round(price * 10000);
        prices.push(bps);
        results.push(`  ${cid.slice(0, 10)}...: ${(price * 100).toFixed(1)}% (${bps} bps)`);
      } else {
        results.push(`  WARNING: No price history for ${cid.slice(0, 10)}..., using 5000`);
        prices.push(5000);
        allPricesFound = false;
      }
    }

    // Submit on-chain
    try {
      const { request } = await client.simulateContract({
        address: roundManagerAddress,
        abi: roundManagerAbi,
        functionName: 'postBenchmarkPrices',
        args: [BigInt(roundId), prices],
        account,
      });

      const txHash = await wallet.writeContract(request);
      results.push(`  Posted benchmarks for round ${roundId}: ${txHash}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push(`  ERROR posting benchmarks for round ${roundId}: ${msg}`);
    }
  }

  return results;
}

/**
 * Check for rounds that need outcomes triggered and pending scores computed.
 * Called by the same EventBridge cron as benchmarks.
 * Curator can trigger during reveal window; anyone can trigger after revealDeadline.
 */
export async function checkAndTriggerOutcomes(): Promise<string[]> {
  const results: string[] = [];

  const now = Math.floor(Date.now() / 1000);
  const data = await querySubgraph(`{
    rounds(where: { benchmarksPosted: true, invalidated: false, outcomesTriggered: false }) {
      roundId
      conditionIds
      revealStart
      revealDeadline
      marketCount
    }
  }`);

  const rounds = data?.rounds || [];
  const ready = rounds.filter((r: any) => Number(r.revealStart) <= now);

  if (ready.length === 0) {
    results.push('No rounds need outcome triggering');
    return results;
  }

  const rpcUrl = process.env.RPC_URL || 'https://polygon-rpc.com';
  const curatorKey = process.env.CURATOR_PRIVATE_KEY || process.env.RELAYER_PRIVATE_KEY;
  if (!curatorKey) {
    results.push('ERROR: No CURATOR_PRIVATE_KEY set');
    return results;
  }

  const ctfAddress = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045' as const;
  const arenaAddress = (process.env.PREDICTION_ARENA_ADDRESS || '0x9CeD2996d759993B955779aAcA7d399708b9b9D7') as `0x${string}`;
  const account = privateKeyToAccount(curatorKey as `0x${string}`);

  const client = createPublicClient({
    chain: polygon as Chain,
    transport: http(rpcUrl),
  });

  const wallet = createWalletClient({
    account,
    chain: polygon as Chain,
    transport: http(rpcUrl),
  });

  for (const round of ready) {
    const roundId = Number(round.roundId);
    const conditionIds: string[] = round.conditionIds || [];
    const marketCount = conditionIds.length;
    const pastDeadline = now >= Number(round.revealDeadline);

    // Check how many markets are resolved on the CTF
    let resolvedCount = 0;
    for (const cid of conditionIds) {
      try {
        const denom = await client.readContract({
          address: ctfAddress,
          abi: ctfAbi,
          functionName: 'payoutDenominator',
          args: [cid as `0x${string}`],
        }) as bigint;
        if (denom > 0n) resolvedCount++;
      } catch {
        // CTF read failed — treat as unresolved
      }
    }

    results.push(`Round ${roundId}: ${resolvedCount}/${marketCount} markets resolved on CTF`);

    // Trigger when ALL markets are resolved, or after revealDeadline with at least one
    if (resolvedCount === marketCount) {
      results.push(`  All markets resolved — triggering outcomes`);
    } else if (pastDeadline && resolvedCount > 0) {
      results.push(`  Past reveal deadline with ${resolvedCount} resolved — triggering with partial outcomes`);
    } else {
      results.push(`  Waiting for more markets to resolve`);
      continue;
    }

    try {
      const { request } = await client.simulateContract({
        address: arenaAddress,
        abi: arenaAbi,
        functionName: 'triggerOutcomesAndScore',
        args: [BigInt(roundId)],
        account,
      });

      const txHash = await wallet.writeContract(request);
      results.push(`  Triggered outcomes + scored round ${roundId}: ${txHash}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push(`  ERROR triggering outcomes for round ${roundId}: ${msg}`);
    }
  }

  return results;
}
