#!/usr/bin/env node
/**
 * Foresight Arena — Random Benchmark Agent
 *
 * A minimal direct-mode agent that participates without relayer or subgraph.
 * Polls for new rounds, commits random predictions, and reveals when ready.
 *
 * Usage:
 *   AGENT_KEY=0x... RPC_URL=https://... node agent.mjs
 *
 * Optional:
 *   AGENT_NAME=MyAgent       (default: Random-<addr>)
 *   AGENT_URL=https://...    (optional metadata URL)
 *   POLL_INTERVAL=7200       (seconds, default: 7200 = 2 hours)
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  encodePacked,
  keccak256,
  getContract,
  parseAbi,
} from 'viem';
import { polygon } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// ─── Config ───────────────────────────────────────────────────────────────────

const AGENT_KEY = process.env.AGENT_KEY;
const RPC_URL = process.env.RPC_URL;
if (!AGENT_KEY) throw new Error('Set AGENT_KEY env var (0x-prefixed private key)');
if (!RPC_URL) throw new Error('Set RPC_URL env var (Polygon RPC endpoint)');

const POLL_INTERVAL = Number(process.env.POLL_INTERVAL || 7200) * 1000;
const AGENT_NAME = process.env.AGENT_NAME;
const AGENT_URL = process.env.AGENT_URL || '';

const ADDRESSES = {
  arena: '0xF0C6EFD4A2F1B10528A360F388fbE45839c1b60f',
  roundManager: '0x625eD13a6c37DA525C96C3FBF65f35E266268Ee0',
  registry: '0x624C60c4a3c7461909412FF9b7A0216d4cB0e637',
  ctf: '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045',
};

// ─── ABIs (minimal) ───────────────────────────────────────────────────────────

const roundManagerAbi = parseAbi([
  'function currentRoundId() view returns (uint256)',
  'function getRound(uint256 roundId) view returns ((bytes32[] conditionIds, uint16[] benchmarkPrices, uint64 commitDeadline, uint64 revealStart, uint64 revealDeadline, uint16 minResolvedMarkets, bool benchmarksPosted, bool invalidated))',
]);

const arenaAbi = parseAbi([
  'function commit(uint256 roundId, bytes32 commitHash)',
  'function reveal(uint256 roundId, uint16[] predictions, bytes32 salt)',
]);

const registryAbi = parseAbi([
  'function isRegistered(address agent) view returns (bool)',
  'function registerAgent(string name, string url, address owner)',
]);

const ctfAbi = parseAbi([
  'function payoutDenominator(bytes32 conditionId) view returns (uint256)',
  'function payoutNumerators(bytes32 conditionId, uint256 index) view returns (uint256)',
]);

// ─── Setup ────────────────────────────────────────────────────────────────────

const account = privateKeyToAccount(AGENT_KEY);
const transport = http(RPC_URL);

const publicClient = createPublicClient({ chain: polygon, transport });
const walletClient = createWalletClient({ chain: polygon, transport, account });

const roundManager = getContract({ address: ADDRESSES.roundManager, abi: roundManagerAbi, client: publicClient });
const arena = getContract({ address: ADDRESSES.arena, abi: arenaAbi, client: publicClient });
const registry = getContract({ address: ADDRESSES.registry, abi: registryAbi, client: publicClient });
const ctf = getContract({ address: ADDRESSES.ctf, abi: ctfAbi, client: publicClient });

// ─── Reveal Queue (persisted to disk) ─────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const QUEUE_PATH = join(__dirname, `reveal-queue-${account.address.toLowerCase()}.json`);

function loadQueue() {
  if (!existsSync(QUEUE_PATH)) return [];
  try { return JSON.parse(readFileSync(QUEUE_PATH, 'utf-8')); }
  catch { return []; }
}

function saveQueue(queue) {
  writeFileSync(QUEUE_PATH, JSON.stringify(queue, null, 2));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function packPredictions(predictions) {
  let packed = '0x';
  for (const p of predictions) packed += encodePacked(['uint16'], [p]).slice(2);
  return packed;
}

function computeCommitHash(roundId, predictions, salt) {
  const packed = encodePacked(['uint256'], [BigInt(roundId)])
    + packPredictions(predictions).slice(2)
    + salt.slice(2);
  return keccak256(packed);
}

function generateSalt() {
  return keccak256(encodePacked(['uint256', 'uint256'], [
    BigInt(Date.now()),
    BigInt(Math.floor(Math.random() * 1e18)),
  ]));
}

function randomPredictions(count) {
  return Array.from({ length: count }, () => Math.floor(Math.random() * 10001));
}

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// ─── Registration ─────────────────────────────────────────────────────────────

async function ensureRegistered() {
  const registered = await registry.read.isRegistered([account.address]);
  if (registered) {
    log(`Already registered: ${account.address}`);
    return;
  }

  const name = AGENT_NAME || `Random-${account.address.slice(2, 8)}`;
  log(`Registering as "${name}"...`);

  const { request } = await publicClient.simulateContract({
    address: ADDRESSES.registry,
    abi: registryAbi,
    functionName: 'registerAgent',
    args: [name, AGENT_URL, account.address],
    account,
  });
  const hash = await walletClient.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  log(`Registered in tx ${receipt.transactionHash} (block ${receipt.blockNumber})`);
}

// ─── Commit ───────────────────────────────────────────────────────────────────

async function tryCommit(roundId, round) {
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (now >= round.commitDeadline) return;
  if (round.invalidated) return;

  const marketCount = round.conditionIds.length;
  const predictions = randomPredictions(marketCount);
  const salt = generateSalt();
  const commitHash = computeCommitHash(roundId, predictions, salt);

  log(`Committing to round ${roundId} (${marketCount} markets)...`);

  try {
    const { request } = await publicClient.simulateContract({
      address: ADDRESSES.arena,
      abi: arenaAbi,
      functionName: 'commit',
      args: [BigInt(roundId), commitHash],
      account,
    });
    const hash = await walletClient.writeContract(request);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    log(`Committed in tx ${receipt.transactionHash}`);

    // Add to reveal queue
    const queue = loadQueue();
    queue.push({
      roundId,
      predictions,
      salt,
      commitHash,
      committedAt: new Date().toISOString(),
    });
    saveQueue(queue);
    log(`Queued reveal for round ${roundId}: predictions=[${predictions.join(',')}]`);
  } catch (err) {
    log(`Commit failed: ${err.message}`);
  }
}

// ─── Reveal ───────────────────────────────────────────────────────────────────

async function processRevealQueue() {
  const queue = loadQueue();
  if (queue.length === 0) return;

  const remaining = [];

  for (const entry of queue) {
    const { roundId, predictions, salt } = entry;

    try {
      const round = await roundManager.read.getRound([BigInt(roundId)]);
      const now = BigInt(Math.floor(Date.now() / 1000));

      // Round invalidated or reveal deadline passed — drop it
      if (round.invalidated || now >= round.revealDeadline) {
        log(`Round ${roundId}: expired or invalidated, dropping from queue`);
        continue;
      }

      // Not in reveal phase yet — keep in queue
      if (now < round.revealStart) {
        remaining.push(entry);
        continue;
      }

      // Benchmarks not posted yet — keep in queue
      if (!round.benchmarksPosted) {
        log(`Round ${roundId}: waiting for benchmarks`);
        remaining.push(entry);
        continue;
      }

      // Check if enough markets are resolved
      let resolvedCount = 0;
      for (const cid of round.conditionIds) {
        const denom = await ctf.read.payoutDenominator([cid]);
        if (denom > 0n) resolvedCount++;
      }

      if (resolvedCount < round.minResolvedMarkets) {
        log(`Round ${roundId}: ${resolvedCount}/${round.minResolvedMarkets} markets resolved, waiting`);
        remaining.push(entry);
        continue;
      }

      // Simulate reveal
      log(`Round ${roundId}: simulating reveal (${resolvedCount} markets resolved)...`);
      const { request } = await publicClient.simulateContract({
        address: ADDRESSES.arena,
        abi: arenaAbi,
        functionName: 'reveal',
        args: [BigInt(roundId), predictions, salt],
        account,
      });

      const hash = await walletClient.writeContract(request);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      log(`Revealed round ${roundId} in tx ${receipt.transactionHash}`);
      // Drop from queue (don't push to remaining)
    } catch (err) {
      if (err.message.includes('Already revealed')) {
        log(`Round ${roundId}: already revealed, dropping`);
      } else {
        log(`Round ${roundId}: reveal failed (${err.message}), keeping in queue`);
        remaining.push(entry);
      }
    }
  }

  saveQueue(remaining);
}

// ─── Main Loop ────────────────────────────────────────────────────────────────

async function main() {
  log(`Agent: ${account.address}`);
  log(`Poll interval: ${POLL_INTERVAL / 1000}s`);
  log(`RPC: ${RPC_URL}`);

  await ensureRegistered();

  let lastSeenRound = 0n;

  // Initial round check
  try {
    lastSeenRound = await roundManager.read.currentRoundId();
    log(`Current round: ${lastSeenRound}`);
  } catch (err) {
    log(`Failed to read currentRoundId: ${err.message}`);
  }

  async function tick() {
    try {
      // 1. Process reveal queue first
      await processRevealQueue();

      // 2. Check for new rounds
      const currentRound = await roundManager.read.currentRoundId();

      if (currentRound > lastSeenRound) {
        log(`New round detected: ${currentRound} (was ${lastSeenRound})`);

        // Try to commit to all new rounds
        for (let id = lastSeenRound + 1n; id <= currentRound; id++) {
          const round = await roundManager.read.getRound([id]);
          await tryCommit(Number(id), round);
        }

        lastSeenRound = currentRound;
      } else {
        log(`No new rounds (current: ${currentRound})`);
      }
    } catch (err) {
      log(`Tick error: ${err.message}`);
    }
  }

  // Run immediately, then on interval
  await tick();
  setInterval(tick, POLL_INTERVAL);
  log(`Running... (Ctrl+C to stop)`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
