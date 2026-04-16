#!/usr/bin/env node
/**
 * Foresight Arena — Random Benchmark Agent
 *
 * A minimal direct-mode agent that participates without relayer or subgraph.
 * Runs once per invocation — designed for crontab scheduling.
 *
 * Usage:
 *   AGENT_KEY=0x... RPC_URL=https://... node agent.mjs
 *
 * Optional:
 *   AGENT_NAME=MyAgent       (default: Random-<addr>)
 *   AGENT_URL=https://...    (optional metadata URL)
 *
 * Crontab example (every 2 hours):
 *   0 *\/2 * * * cd /path/to/agents/random-benchmark && AGENT_KEY=0x... RPC_URL=https://... node agent.mjs >> agent.log 2>&1
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

const AGENT_NAME = process.env.AGENT_NAME;
const AGENT_URL = process.env.AGENT_URL || '';

const ADDRESSES = {
  arena: '0x5f28d56B4aBBE662c29755701C4a5f801Ace9D2a',
  roundManager: '0x9EB0BF21cE99f463Af2Ca67b4aFDa40e4905AE95',
  agentNFT: '0xf3C9Fbc0F94fd69cFc4c645Ba567C97dD190AAA7',
};

// ─── ABIs (minimal) ───────────────────────────────────────────────────────────

const roundManagerAbi = parseAbi([
  'function currentRoundId() view returns (uint256)',
  'function getRound(uint256 roundId) view returns ((bytes32[] conditionIds, uint16[] benchmarkPrices, uint64 commitDeadline, uint64 revealStart, uint64 revealDeadline, uint16 minResolvedMarkets, bool benchmarksPosted, bool invalidated))',
]);

const arenaAbi = parseAbi([
  'function commit(uint256 roundId, bytes32 commitHash, bytes32 reasoningHash)',
  'function reveal(uint256 roundId, uint16[] predictions, bytes32 salt)',
]);

const agentNFTAbi = parseAbi([
  'function agentIdOf(address agent) view returns (uint256)',
  'function register(string name, string url)',
]);

// ─── Setup ────────────────────────────────────────────────────────────────────

const account = privateKeyToAccount(AGENT_KEY);
const transport = http(RPC_URL);

const publicClient = createPublicClient({ chain: polygon, transport });
const walletClient = createWalletClient({ chain: polygon, transport, account });

const roundManager = getContract({ address: ADDRESSES.roundManager, abi: roundManagerAbi, client: publicClient });
const agentNFT = getContract({ address: ADDRESSES.agentNFT, abi: agentNFTAbi, client: publicClient });

// ─── Persistent State (survives between cron runs) ────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const QUEUE_PATH = join(__dirname, `reveal-queue-${account.address.toLowerCase()}.json`);
const STATE_PATH = join(__dirname, `state-${account.address.toLowerCase()}.json`);

function loadQueue() {
  if (!existsSync(QUEUE_PATH)) return [];
  try { return JSON.parse(readFileSync(QUEUE_PATH, 'utf-8')); }
  catch { return []; }
}

function saveQueue(queue) {
  writeFileSync(QUEUE_PATH, JSON.stringify(queue, null, 2));
}

function loadState() {
  if (!existsSync(STATE_PATH)) return {};
  try { return JSON.parse(readFileSync(STATE_PATH, 'utf-8')); }
  catch { return {}; }
}

function saveState(state) {
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
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
  const agentId = await agentNFT.read.agentIdOf([account.address]);
  if (agentId > 0n) return;

  const name = AGENT_NAME || `Random-${account.address.slice(2, 8)}`;
  log(`Registering as "${name}"...`);

  const { request } = await publicClient.simulateContract({
    address: ADDRESSES.agentNFT,
    abi: agentNFTAbi,
    functionName: 'register',
    args: [name, AGENT_URL],
    account,
  });
  const hash = await walletClient.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  log(`Registered in tx ${receipt.transactionHash}`);
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
      args: [BigInt(roundId), commitHash, '0xf3C9Fbc0F94fd69cFc4c645Ba567C97dD190AAA7000000000000000000000000'],
      account,
    });
    const hash = await walletClient.writeContract(request);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    log(`Committed in tx ${receipt.transactionHash}`);

    // Add to reveal queue
    const queue = loadQueue();
    queue.push({ roundId, predictions, salt, commitHash, committedAt: new Date().toISOString() });
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

      // Simulate reveal — scoring is deferred until curator triggers outcomes
      log(`Round ${roundId}: simulating reveal...`);
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

// ─── Main (single run) ───────────────────────────────────────────────────────

async function main() {
  log(`Agent: ${account.address}`);

  await ensureRegistered();

  // 1. Process reveal queue
  await processRevealQueue();

  // 2. Check for new rounds
  const state = loadState();
  let lastSeenRound = BigInt(state.lastSeenRound || 0);
  const currentRound = await roundManager.read.currentRoundId();

  if (lastSeenRound === 0n) {
    // First run — start from current round
    log(`First run, starting from round ${currentRound}`);
    lastSeenRound = currentRound;
  }

  if (currentRound > lastSeenRound) {
    for (let id = lastSeenRound + 1n; id <= currentRound; id++) {
      const round = await roundManager.read.getRound([id]);
      await tryCommit(Number(id), round);
    }
  } else {
    log(`No new rounds (current: ${currentRound})`);
  }

  saveState({ lastSeenRound: currentRound.toString() });
  log('Done.');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
