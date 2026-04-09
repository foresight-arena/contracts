#!/usr/bin/env node
/**
 * Foresight Arena — LLM Benchmark Agent
 *
 * Uses an LLM (via OpenRouter) with tool use to predict market outcomes.
 * Same prompt is used across all models for fair comparison.
 *
 * Usage:
 *   AGENT_KEY=0x... RPC_URL=https://... MODEL=anthropic/claude-opus-4 \
 *     OPENROUTER_API_KEY=... TAVILY_API_KEY=... node agent.mjs
 *
 * Optional:
 *   AGENT_NAME=MyAgent       (default: <model-slug>-<addr>)
 *   AGENT_URL=https://...    (optional metadata URL)
 *   DRY_RUN=1                (predict only, do not commit on-chain)
 *   ROUND_ID=42              (only used in DRY_RUN; default: current round)
 *   RELAYER_URL=https://...  (if set, posts reasoning JSON to /reasoning endpoint)
 *   MODE=all                 (discover|predict|all — default: all)
 *   LEAD_TIME_SECONDS=600    (predict when remaining < this many seconds; default 600 = 10m)
 *
 * Crontab example (every 2 hours):
 *   0 *\/2 * * * cd /path/to/agents/llm-benchmark && AGENT_KEY=... RPC_URL=... MODEL=... OPENROUTER_API_KEY=... node agent.mjs >> agent.log 2>&1
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
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { getMarkets, summarizeMarket } from './lib/polymarket.mjs';
import { createTools } from './lib/tools.mjs';
import { buildPrompt } from './lib/prompt.mjs';
import { getPredictions } from './lib/llm.mjs';
import { postReasoning } from './lib/reasoning-poster.mjs';

// ─── Config ───────────────────────────────────────────────────────────────────

const AGENT_KEY = process.env.AGENT_KEY;
const RPC_URL = process.env.RPC_URL;
const MODEL = process.env.MODEL;
const DRY_RUN = !!process.env.DRY_RUN;

if (!AGENT_KEY) throw new Error('Set AGENT_KEY env var (0x-prefixed private key)');
if (!RPC_URL) throw new Error('Set RPC_URL env var (Polygon RPC endpoint)');
if (!MODEL) throw new Error('Set MODEL env var (e.g. anthropic/claude-opus-4)');

const AGENT_NAME = process.env.AGENT_NAME;
const AGENT_URL = process.env.AGENT_URL || '';
const TAVILY_KEY = process.env.TAVILY_API_KEY || '';
const ROUND_ID_OVERRIDE = process.env.ROUND_ID ? BigInt(process.env.ROUND_ID) : null;
const RELAYER_URL = process.env.RELAYER_URL || '';
const MODE = (process.env.MODE || 'all').toLowerCase();
const LEAD_TIME_SECONDS = Number(process.env.LEAD_TIME_SECONDS || 600);
if (!['discover', 'predict', 'all'].includes(MODE)) {
  throw new Error(`Invalid MODE: ${MODE} (must be discover|predict|all)`);
}

const ADDRESSES = {
  arena: '0xF0C6EFD4A2F1B10528A360F388fbE45839c1b60f',
  roundManager: '0x625eD13a6c37DA525C96C3FBF65f35E266268Ee0',
  registry: '0x624C60c4a3c7461909412FF9b7A0216d4cB0e637',
  ctf: '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045',
};

// ─── ABIs ─────────────────────────────────────────────────────────────────────

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
]);

// ─── Setup ────────────────────────────────────────────────────────────────────

const account = privateKeyToAccount(AGENT_KEY);
const transport = http(RPC_URL);
const publicClient = createPublicClient({ chain: polygon, transport });
const walletClient = createWalletClient({ chain: polygon, transport, account });

const roundManager = getContract({ address: ADDRESSES.roundManager, abi: roundManagerAbi, client: publicClient });
const registry = getContract({ address: ADDRESSES.registry, abi: registryAbi, client: publicClient });
const ctf = getContract({ address: ADDRESSES.ctf, abi: ctfAbi, client: publicClient });

// ─── Persistent State ─────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_DIR = join(__dirname, 'state');
if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });

const slug = `${MODEL.replace(/[\/:]/g, '_')}-${account.address.toLowerCase()}`;
const QUEUE_PATH = join(STATE_DIR, `reveal-queue-${slug}.json`);
const PENDING_PATH = join(STATE_DIR, `pending-predictions-${slug}.json`);
const STATE_PATH = join(STATE_DIR, `state-${slug}.json`);

function loadQueue() {
  if (!existsSync(QUEUE_PATH)) return [];
  try { return JSON.parse(readFileSync(QUEUE_PATH, 'utf-8')); }
  catch { return []; }
}

function saveQueue(queue) {
  writeFileSync(QUEUE_PATH, JSON.stringify(queue, null, 2));
}

function loadPending() {
  if (!existsSync(PENDING_PATH)) return [];
  try { return JSON.parse(readFileSync(PENDING_PATH, 'utf-8')); }
  catch { return []; }
}

function savePending(pending) {
  writeFileSync(PENDING_PATH, JSON.stringify(pending, null, 2));
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

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// ─── Registration ─────────────────────────────────────────────────────────────

async function ensureRegistered() {
  const registered = await registry.read.isRegistered([account.address]);
  if (registered) return;

  const name = AGENT_NAME || `${MODEL.split('/').pop()}-${account.address.slice(2, 8)}`;
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
  log(`Registered in tx ${receipt.transactionHash}`);
}

// ─── LLM Prediction Pipeline ──────────────────────────────────────────────────

async function predictRound(roundId, round) {
  log(`Fetching market metadata for round ${roundId} (${round.conditionIds.length} markets)...`);
  const marketsRaw = await getMarkets(round.conditionIds);
  const summaries = marketsRaw.map((m, i) => summarizeMarket(m, i));

  const tools = createTools({ markets: summaries, marketsRaw, tavilyKey: TAVILY_KEY });
  const prompt = buildPrompt({ roundId, round, summaries, hasWebSearch: !!TAVILY_KEY });

  log(`Calling ${MODEL}...`);
  const result = await getPredictions({
    model: MODEL,
    prompt,
    baseTools: tools,
    marketCount: round.conditionIds.length,
  });

  log(`Predictions: [${result.predictions.join(',')}]`);
  if (result.usage) {
    log(`Token usage: ${result.usage.promptTokens || '?'} prompt + ${result.usage.completionTokens || '?'} completion`);
  }
  if (result.reasoning) {
    log(`Reasoning:\n${result.reasoning}`);
  }

  return { predictions: result.predictions, summaries, result };
}

function buildReasoningPayload({ roundId, summaries, result }) {
  return {
    roundId,
    agent: account.address,
    model: MODEL,
    timestamp: new Date().toISOString(),
    markets: summaries,
    predictions: result.predictions,
    perMarketReasoning: result.perMarketReasoning,
    trace: result.trace,
    usage: result.usage || null,
  };
}

// ─── Commit ───────────────────────────────────────────────────────────────────

async function tryCommit(roundId, round) {
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (!DRY_RUN && now >= round.commitDeadline) {
    log(`Round ${roundId}: commit deadline passed, skipping`);
    return;
  }
  if (!DRY_RUN && round.invalidated) {
    log(`Round ${roundId}: invalidated, skipping`);
    return;
  }

  let predictions, summaries, result;
  try {
    ({ predictions, summaries, result } = await predictRound(roundId, round));
  } catch (err) {
    log(`Round ${roundId}: prediction failed (${err.message})`);
    return;
  }

  if (predictions.length !== round.conditionIds.length) {
    log(`Round ${roundId}: prediction count mismatch (${predictions.length} vs ${round.conditionIds.length})`);
    return;
  }

  if (DRY_RUN) {
    log(`Round ${roundId}: DRY_RUN — skipping on-chain commit`);
    return;
  }

  const salt = generateSalt();
  const commitHash = computeCommitHash(roundId, predictions, salt);

  log(`Round ${roundId}: committing on-chain...`);

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

    const queue = loadQueue();
    queue.push({ roundId, predictions, salt, commitHash, committedAt: new Date().toISOString() });
    saveQueue(queue);
    log(`Queued reveal for round ${roundId}`);

    // Optionally post reasoning to relayer
    if (RELAYER_URL) {
      try {
        const payload = buildReasoningPayload({ roundId, summaries, result });
        const resp = await postReasoning({
          relayerUrl: RELAYER_URL,
          account,
          arenaAddress: ADDRESSES.arena,
          roundId,
          content: payload,
        });
        log(`Reasoning posted: ${resp.key} (${resp.size} bytes)`);
      } catch (err) {
        log(`Reasoning post failed: ${err.message}`);
      }
    }
  } catch (err) {
    log(`Commit failed: ${err.message}`);
  }
}

// ─── Reveal ───────────────────────────────────────────────────────────────────

async function processRevealQueue() {
  if (DRY_RUN) return;

  const queue = loadQueue();
  if (queue.length === 0) return;

  const remaining = [];

  for (const entry of queue) {
    const { roundId, predictions, salt } = entry;

    try {
      const round = await roundManager.read.getRound([BigInt(roundId)]);
      const now = BigInt(Math.floor(Date.now() / 1000));

      if (round.invalidated || now >= round.revealDeadline) {
        log(`Round ${roundId}: expired or invalidated, dropping from queue`);
        continue;
      }

      if (now < round.revealStart) {
        remaining.push(entry);
        continue;
      }

      if (!round.benchmarksPosted) {
        log(`Round ${roundId}: waiting for benchmarks`);
        remaining.push(entry);
        continue;
      }

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

// ─── Discovery & Pending Predictions ──────────────────────────────────────────

async function discoverNewRounds() {
  const state = loadState();
  let lastSeenRound = BigInt(state.lastSeenRound || 0);
  const currentRound = await roundManager.read.currentRoundId();

  if (lastSeenRound === 0n) {
    log(`First run, starting from round ${currentRound}`);
    lastSeenRound = currentRound - 1n; // include current round in scan
  }

  if (currentRound <= lastSeenRound) {
    log(`No new rounds (current: ${currentRound})`);
    return;
  }

  const pending = loadPending();
  const known = new Set(pending.map((p) => p.roundId));
  const now = BigInt(Math.floor(Date.now() / 1000));
  let added = 0;

  for (let id = lastSeenRound + 1n; id <= currentRound; id++) {
    if (known.has(Number(id))) continue;
    const round = await roundManager.read.getRound([id]);

    if (round.invalidated) {
      log(`Round ${id}: invalidated, skipping`);
      continue;
    }
    if (round.conditionIds.length === 0) {
      log(`Round ${id}: empty, skipping`);
      continue;
    }
    if (now >= round.commitDeadline) {
      log(`Round ${id}: commit deadline already passed, skipping`);
      continue;
    }

    pending.push({
      roundId: Number(id),
      commitDeadline: Number(round.commitDeadline),
      discoveredAt: new Date().toISOString(),
    });
    added++;
    log(`Discovered round ${id} (commit deadline ${new Date(Number(round.commitDeadline) * 1000).toISOString()})`);
  }

  savePending(pending);
  saveState({ lastSeenRound: currentRound.toString() });
  if (added > 0) log(`Added ${added} round(s) to pending queue (total pending: ${pending.length})`);
}

async function processPendingPredictions() {
  const pending = loadPending();
  if (pending.length === 0) return;

  const now = Math.floor(Date.now() / 1000);
  const remaining = [];

  for (const entry of pending) {
    const { roundId, commitDeadline } = entry;
    const remainingSec = commitDeadline - now;

    // Drop expired rounds
    if (remainingSec <= 0) {
      log(`Round ${roundId}: commit deadline passed, dropping from pending`);
      continue;
    }

    // Not yet within lead window — leave in queue
    if (remainingSec > LEAD_TIME_SECONDS) {
      log(`Round ${roundId}: ${remainingSec}s until commit deadline (>${LEAD_TIME_SECONDS}s lead), waiting`);
      remaining.push(entry);
      continue;
    }

    // Within lead window — fetch fresh round and commit
    log(`Round ${roundId}: ${remainingSec}s until deadline, predicting now`);
    const round = await roundManager.read.getRound([BigInt(roundId)]);
    if (round.invalidated) {
      log(`Round ${roundId}: invalidated since discovery, dropping`);
      continue;
    }
    await tryCommit(roundId, round);
    // Always drop from pending after attempt — if commit failed, we don't retry
    // (deadline is too close to risk hitting it again)
  }

  savePending(remaining);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  log(`Agent: ${account.address}`);
  log(`Model: ${MODEL}`);
  log(`Mode: ${MODE}`);
  log(`Lead time: ${LEAD_TIME_SECONDS}s`);
  log(`Web search: ${TAVILY_KEY ? 'enabled' : 'disabled'}`);
  if (DRY_RUN) log(`DRY RUN — no on-chain transactions will be sent`);

  // DRY_RUN bypasses all queue logic and predicts a single round directly
  if (DRY_RUN) {
    const currentRound = await roundManager.read.currentRoundId();
    const targetRound = ROUND_ID_OVERRIDE ?? currentRound;
    log(`Predicting round ${targetRound}${ROUND_ID_OVERRIDE ? ' (override)' : ''}...`);
    const round = await roundManager.read.getRound([targetRound]);
    if (round.conditionIds.length === 0) {
      log(`Round ${targetRound} does not exist`);
      return;
    }
    await tryCommit(Number(targetRound), round);
    log('Done.');
    return;
  }

  await ensureRegistered();

  // discover mode: housekeeping — scan for new rounds + process reveal queue
  if (MODE === 'discover' || MODE === 'all') {
    await discoverNewRounds();
    await processRevealQueue();
  }

  // predict mode: time-critical — predict rounds near commit deadline
  if (MODE === 'predict' || MODE === 'all') {
    await processPendingPredictions();
  }

  log('Done.');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
