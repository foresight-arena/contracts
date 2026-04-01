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
    // clobTokenIds[0] is the YES token
    const tokenIds = m.clobTokenIds;
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

  const roundManagerAddress = (process.env.ROUND_MANAGER_ADDRESS || '0xa7BfBA3c20bB5c73A685eDb47b3454D3E3A5C58E') as `0x${string}`;
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
