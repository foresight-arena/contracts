#!/usr/bin/env node
/**
 * Foresight Arena — LLM Benchmark Agent
 *
 * Uses an LLM (via OpenRouter or Amazon Bedrock) with tool use to predict market outcomes.
 * Same prompt is used across all models for fair comparison.
 *
 * Usage:
 *   AGENT_KEY=0x... RPC_URL=https://... MODEL=anthropic/claude-opus-4 \
 *     OPENROUTER_API_KEY=... TAVILY_API_KEY=... node agent.mjs
 *
 *   # Amazon Bedrock model + AgentCore Web Search (AWS creds from the default chain)
 *   AGENT_KEY=0x... RPC_URL=https://... LLM_PROVIDER=bedrock \
 *     MODEL=us.anthropic.claude-sonnet-4-5-20250929-v1:0 AWS_REGION=us-east-1 \
 *     AGENTCORE_GATEWAY_URL=https://gateway-<id>.gateway.bedrock-agentcore.us-east-1.amazonaws.com/mcp \
 *     node agent.mjs
 *
 * Optional:
 *   LLM_PROVIDER=openrouter  (openrouter|bedrock — default: openrouter)
 *   SEARCH_PROVIDER=...      (tavily|agentcore|none — default: agentcore if AGENTCORE_GATEWAY_URL,
 *                             else tavily if TAVILY_API_KEY, else none)
 *   AGENT_NAME=MyAgent       (display name; embedded in an on-chain data: URL if set — along with MODEL)
 *   AGENT_URL=https://...    (explicit agentURI; overrides AGENT_NAME. Point to JSON with name/description)
 *   DRY_RUN=1                (predict only, do not commit on-chain)
 *   ROUND_ID=42              (only used in DRY_RUN; default: current round)
 *   RELAYER_URL=https://...  (if set, posts reasoning JSON to /reasoning endpoint)
 *   MODE=all                 (discover|predict|all — default: all)
 *   LEAD_TIME_SECONDS=600    (predict when remaining < this many seconds; default 600 = 10m)
 *   MAX_COMMIT_BASE_FEE_GWEI=1000   (skip commit if Polygon base fee exceeds this; default 1000)
 *   MAX_REVEAL_BASE_FEE_GWEI=200    (defer reveal if Polygon base fee exceeds this; default 200)
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
  toBytes,
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
import { getPredictions, LLM_PROVIDERS } from './lib/llm.mjs';
import { resolveSearchProvider, createWebSearch } from './lib/search.mjs';

// ─── Config ───────────────────────────────────────────────────────────────────

const AGENT_KEY = process.env.AGENT_KEY;
const RPC_URL = process.env.RPC_URL;
const MODEL = process.env.MODEL;
const LLM_PROVIDER = (process.env.LLM_PROVIDER || 'openrouter').toLowerCase();
const DRY_RUN = !!process.env.DRY_RUN;

if (!AGENT_KEY) throw new Error('Set AGENT_KEY env var (0x-prefixed private key)');
if (!RPC_URL) throw new Error('Set RPC_URL env var (Polygon RPC endpoint)');
if (!MODEL) throw new Error('Set MODEL env var (e.g. anthropic/claude-opus-4)');
if (!LLM_PROVIDERS.includes(LLM_PROVIDER)) {
  throw new Error(`Invalid LLM_PROVIDER: ${LLM_PROVIDER} (must be ${LLM_PROVIDERS.join('|')})`);
}

const AGENT_URL = process.env.AGENT_URL || '';
const AGENT_NAME = process.env.AGENT_NAME || '';

/**
 * Build the agentURI to register with.
 *  - If AGENT_URL is set, use it directly (external JSON).
 *  - Else if AGENT_NAME is set, inline a minimal JSON as a data: URL (on-chain).
 *  - Else empty string (no metadata).
 */
function buildAgentURI() {
  if (AGENT_URL) return AGENT_URL;
  if (AGENT_NAME) {
    const addr = account.address.toLowerCase();
    const meta = {
      type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
      name: AGENT_NAME,
      description: `AI prediction agent competing in Foresight Arena — an on-chain forecasting competition for AI agents on Polygon. Predicts Polymarket outcomes using ${MODEL}.`,
      image: `https://api.foresightarena.xyz/agent/${addr}/image`,
      external_url: `https://foresightarena.xyz/agent/${addr}`,
      active: true,
      registrations: [
        {
          agentRegistry: 'eip155:137:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
        },
      ],
    };
    return 'data:application/json;base64,' + Buffer.from(JSON.stringify(meta)).toString('base64');
  }
  return '';
}
const SEARCH_PROVIDER = resolveSearchProvider(process.env);
let webSearch = createWebSearch(SEARCH_PROVIDER, process.env);
const ROUND_ID_OVERRIDE = process.env.ROUND_ID ? BigInt(process.env.ROUND_ID) : null;
const RELAYER_URL = process.env.RELAYER_URL || '';
const MODE = (process.env.MODE || 'all').toLowerCase();
const LEAD_TIME_SECONDS = Number(process.env.LEAD_TIME_SECONDS || 600);
const MAX_COMMIT_BASE_FEE_GWEI = Number(process.env.MAX_COMMIT_BASE_FEE_GWEI || 1000);
const MAX_REVEAL_BASE_FEE_GWEI = Number(process.env.MAX_REVEAL_BASE_FEE_GWEI || 200);
if (!['discover', 'predict', 'all'].includes(MODE)) {
  throw new Error(`Invalid MODE: ${MODE} (must be discover|predict|all)`);
}

const ADDRESSES = {
  arena: '0x9CeD2996d759993B955779aAcA7d399708b9b9D7',
  roundManager: '0x033C47EdE0030aDf72a4ea6B6B32DC4Bf60d2B5c',
  identityRegistry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432', // canonical ERC-8004
  ctf: '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045',
};

// ─── ABIs ─────────────────────────────────────────────────────────────────────

const roundManagerAbi = parseAbi([
  'function currentRoundId() view returns (uint256)',
  'function getRound(uint256 roundId) view returns ((bytes32[] conditionIds, uint16[] benchmarkPrices, uint64 commitDeadline, uint64 revealStart, uint64 revealDeadline, bool benchmarksPosted, bool invalidated))',
]);

const arenaAbi = parseAbi([
  'function commit(uint256 roundId, bytes32 commitHash, bytes32 reasoningHash)',
  'function reveal(uint256 roundId, uint16[] predictions, bytes32 salt)',
]);

const identityRegistryAbi = parseAbi([
  'function register(string agentURI) returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
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
const identityRegistry = getContract({ address: ADDRESSES.identityRegistry, abi: identityRegistryAbi, client: publicClient });
const ctf = getContract({ address: ADDRESSES.ctf, abi: ctfAbi, client: publicClient });

// ─── Persistent State ─────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_DIR = join(__dirname, 'state');
if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });

const slug = `${MODEL.replace(/[\/:]/g, '_')}-${account.address.toLowerCase()}`;
const QUEUE_PATH = join(STATE_DIR, `reveal-queue-${slug}.json`);
const PENDING_PATH = join(STATE_DIR, `pending-predictions-${slug}.json`);
const STATE_PATH = join(STATE_DIR, `state-${slug}.json`);
const REGISTERED_FLAG_PATH = join(STATE_DIR, `registered-${account.address.toLowerCase()}.flag`);
const REASONING_DIR = join(STATE_DIR, 'reasoning');

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

/**
 * Canonical JSON serialization — sorted keys, matches relayer's canonicalize().
 */
function canonicalize(content) {
  if (content === null || typeof content !== 'object') return JSON.stringify(content);
  if (Array.isArray(content)) return '[' + content.map(canonicalize).join(',') + ']';
  const keys = Object.keys(content).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize(content[k])).join(',') + '}';
}

// ─── Registration ─────────────────────────────────────────────────────────────

async function ensureRegistered() {
  // Cached: skip the RPC check entirely once we know the agent holds an NFT
  if (existsSync(REGISTERED_FLAG_PATH)) return;

  // Check if already registered on canonical ERC-8004 Identity Registry
  const balance = await identityRegistry.read.balanceOf([account.address]);
  if (balance > 0n) {
    writeFileSync(REGISTERED_FLAG_PATH, new Date().toISOString());
    return;
  }

  const agentURI = buildAgentURI();
  log(`Registering on canonical Identity Registry${agentURI ? ` with URI (${agentURI.length} bytes)` : ' (no URI)'}...`);

  const { request } = await publicClient.simulateContract({
    address: ADDRESSES.identityRegistry,
    abi: identityRegistryAbi,
    functionName: 'register',
    args: [agentURI],
    account,
  });
  const hash = await walletClient.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  writeFileSync(REGISTERED_FLAG_PATH, new Date().toISOString());
  log(`Registered in tx ${receipt.transactionHash}`);
}

// ─── LLM Prediction Pipeline ──────────────────────────────────────────────────

/**
 * Check the CTF for which markets in this round are already resolved.
 * Returns an array of 'YES' | 'NO' | null (one per condition ID).
 */
async function checkResolutions(conditionIds) {
  return Promise.all(
    conditionIds.map(async (cid) => {
      try {
        const denom = await ctf.read.payoutDenominator([cid]);
        if (denom === 0n) return null;
        const payout0 = await ctf.read.payoutNumerators([cid, 0n]);
        return payout0 > 0n ? 'YES' : 'NO';
      } catch {
        return null;
      }
    }),
  );
}

async function predictRound(roundId, round) {
  log(`Fetching market metadata for round ${roundId} (${round.conditionIds.length} markets)...`);
  const marketsRaw = await getMarkets(round.conditionIds);
  const summaries = marketsRaw.map((m, i) => summarizeMarket(m, i));

  // Check which markets are already resolved on the CTF
  log(`Checking resolution status...`);
  const resolutions = await checkResolutions(round.conditionIds);
  const unresolvedIndices = [];
  const finalPredictions = new Array(round.conditionIds.length).fill(null);
  const autoResolved = [];

  for (let i = 0; i < resolutions.length; i++) {
    if (resolutions[i] === 'YES') {
      finalPredictions[i] = 10000;
      autoResolved.push({ index: i, outcome: 'YES' });
    } else if (resolutions[i] === 'NO') {
      finalPredictions[i] = 0;
      autoResolved.push({ index: i, outcome: 'NO' });
    } else {
      unresolvedIndices.push(i);
    }
  }

  if (autoResolved.length > 0) {
    log(`${autoResolved.length}/${round.conditionIds.length} markets already resolved — auto-filled`);
  }

  // If everything is resolved, skip the LLM entirely
  if (unresolvedIndices.length === 0) {
    log(`All markets resolved — skipping LLM call`);
    return {
      predictions: finalPredictions,
      summaries,
      result: {
        predictions: finalPredictions,
        reasoning: 'All markets pre-resolved',
        perMarketReasoning: autoResolved.map((a) => ({
          marketIndex: a.index,
          probabilityBps: a.outcome === 'YES' ? 10000 : 0,
          reasoning: `Auto-filled: market resolved ${a.outcome} on CTF`,
        })),
        trace: [],
        usage: null,
      },
      autoResolved,
    };
  }

  // Build a filtered subset for the LLM — only unresolved markets
  const subsetMarketsRaw = unresolvedIndices.map((i) => marketsRaw[i]);
  const subsetSummaries = unresolvedIndices.map((origIdx, newIdx) => ({
    ...summarizeMarket(marketsRaw[origIdx], newIdx),
    originalIndex: origIdx,
  }));

  const tools = createTools({ markets: subsetSummaries, marketsRaw: subsetMarketsRaw, webSearch });
  const prompt = buildPrompt({ roundId, round, summaries: subsetSummaries, hasWebSearch: !!webSearch, now: new Date() });

  log(`Calling ${LLM_PROVIDER}:${MODEL} for ${unresolvedIndices.length} unresolved market(s)...`);
  const result = await getPredictions({
    provider: LLM_PROVIDER,
    model: MODEL,
    prompt,
    baseTools: tools,
    marketCount: unresolvedIndices.length,
  });

  // Map LLM's subset predictions back to original indices
  for (let newIdx = 0; newIdx < unresolvedIndices.length; newIdx++) {
    const origIdx = unresolvedIndices[newIdx];
    finalPredictions[origIdx] = result.predictions[newIdx];
  }

  // Map per-market reasoning back to original indices
  const fullPerMarketReasoning = autoResolved
    .map((a) => ({
      marketIndex: a.index,
      probabilityBps: a.outcome === 'YES' ? 10000 : 0,
      reasoning: `Auto-filled: market resolved ${a.outcome} on CTF`,
    }))
    .concat(
      result.perMarketReasoning.map((p) => ({
        ...p,
        marketIndex: unresolvedIndices[p.marketIndex],
      })),
    )
    .sort((a, b) => a.marketIndex - b.marketIndex);

  log(`Predictions: [${finalPredictions.join(',')}]`);
  if (result.usage) {
    const u = result.usage;
    const cache = u.cacheReadTokens != null ? ` (cache: ${u.cacheReadTokens} read, ${u.cacheWriteTokens} write)` : '';
    log(`Token usage: ${u.promptTokens || '?'} prompt + ${u.completionTokens || '?'} completion${cache}`);
  }

  return {
    predictions: finalPredictions,
    summaries,
    result: {
      ...result,
      predictions: finalPredictions,
      perMarketReasoning: fullPerMarketReasoning,
    },
    autoResolved,
  };
}

function buildReasoningPayload({ result }) {
  // Just an array of reasoning strings, one per market (sorted by marketIndex).
  // The hash of this array is committed on-chain, binding it to the round and predictions.
  return (result.perMarketReasoning || [])
    .sort((a, b) => a.marketIndex - b.marketIndex)
    .map((p) => p.reasoning || '');
}

// ─── Local reasoning log ──────────────────────────────────────────────────────

/**
 * Write the full prediction result (per-market reasoning + tool trace with every
 * search query and result) to state/reasoning/ for post-hoc inspection.
 * Local only — the relayer receives just the per-market reasoning strings.
 */
function saveReasoningLog(roundId, { summaries, result, autoResolved }) {
  try {
    if (!existsSync(REASONING_DIR)) mkdirSync(REASONING_DIR, { recursive: true });
    const ts = new Date().toISOString();
    const path = join(REASONING_DIR, `${slug}-round-${roundId}-${ts.replace(/[:.]/g, '-')}${DRY_RUN ? '-dryrun' : ''}.json`);
    writeFileSync(path, JSON.stringify({
      roundId,
      timestamp: ts,
      dryRun: DRY_RUN,
      provider: LLM_PROVIDER,
      model: MODEL,
      searchProvider: webSearch ? SEARCH_PROVIDER : 'none',
      markets: summaries,
      autoResolved,
      predictions: result.predictions,
      perMarketReasoning: result.perMarketReasoning,
      usage: result.usage,
      trace: result.trace,
    }, null, 2));
    log(`Reasoning log saved to ${path}`);
  } catch (err) {
    log(`Failed to save reasoning log: ${err.message}`);
  }
}

function printReasoning(result) {
  for (const step of result.trace || []) {
    for (const tc of step.toolCalls) log(`  step ${step.step}: ${tc.tool}(${JSON.stringify(tc.args).slice(0, 160)})`);
  }
  for (const p of result.perMarketReasoning || []) {
    log(`  [${p.marketIndex}] ${p.probabilityBps} bps — ${p.reasoning}`);
  }
}

// ─── Gas cap ──────────────────────────────────────────────────────────────────

async function baseFeeGwei() {
  const block = await publicClient.getBlock({ blockTag: 'latest' });
  return Number(block.baseFeePerGas ?? 0n) / 1e9;
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

  let predictions, summaries, result, autoResolved;
  try {
    ({ predictions, summaries, result, autoResolved } = await predictRound(roundId, round));
  } catch (err) {
    log(`Round ${roundId}: prediction failed (${err.message})`);
    return;
  }

  if (predictions.length !== round.conditionIds.length) {
    log(`Round ${roundId}: prediction count mismatch (${predictions.length} vs ${round.conditionIds.length})`);
    return;
  }

  saveReasoningLog(roundId, { summaries, result, autoResolved });

  if (DRY_RUN) {
    printReasoning(result);
    log(`Round ${roundId}: DRY_RUN — skipping on-chain commit`);
    return;
  }

  const fee = await baseFeeGwei();
  if (fee > MAX_COMMIT_BASE_FEE_GWEI) {
    log(`Round ${roundId}: base fee ${fee.toFixed(0)} gwei > ${MAX_COMMIT_BASE_FEE_GWEI} cap, skipping commit`);
    return;
  }

  const salt = generateSalt();
  const commitHash = computeCommitHash(roundId, predictions, salt);

  const reasoningPayload = RELAYER_URL
    ? buildReasoningPayload({ result })
    : undefined;

  const reasoningHash = reasoningPayload
    ? keccak256(toBytes(canonicalize(reasoningPayload)))
    : '0x0000000000000000000000000000000000000000000000000000000000000000';

  log(`Round ${roundId}: committing on-chain...`);

  try {
    const { request } = await publicClient.simulateContract({
      address: ADDRESSES.arena,
      abi: arenaAbi,
      functionName: 'commit',
      args: [BigInt(roundId), commitHash, reasoningHash],
      account,
    });
    const hash = await walletClient.writeContract(request);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    log(`Committed in tx ${receipt.transactionHash}`);

    const queue = loadQueue();
    queue.push({ roundId, predictions, salt, commitHash, committedAt: new Date().toISOString(), reasoningPayload });
    saveQueue(queue);
    log(`Queued reveal for round ${roundId}`);
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

      const fee = await baseFeeGwei();
      if (fee > MAX_REVEAL_BASE_FEE_GWEI) {
        log(`Round ${roundId}: base fee ${fee.toFixed(0)} gwei > ${MAX_REVEAL_BASE_FEE_GWEI} cap, deferring reveal`);
        remaining.push(entry);
        continue;
      }

      // Post reasoning before reveal (relayer verifies by hash)
      if (RELAYER_URL && entry.reasoningPayload) {
        try {
          const resp = await fetch(`${RELAYER_URL}/reasoning`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ roundId, agent: account.address, content: entry.reasoningPayload }),
          });
          const data = await resp.json();
          if (!resp.ok || !data.success) {
            log(`Reasoning post failed: ${data.error || resp.status}`);
          } else {
            log(`Reasoning posted for round ${roundId}`);
          }
        } catch (err) {
          log(`Reasoning post failed: ${err.message}`);
        }
      }

      // Scoring is deferred until curator triggers outcomes — just reveal
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

// ─── Web search preflight ─────────────────────────────────────────────────────

/**
 * Verify the search backend before any LLM call, so a misconfigured gateway is
 * caught up front instead of the model silently getting errors from searchWeb.
 * DRY_RUN fails hard; live runs log and continue WITHOUT search (never block
 * reveals, which run in the same process in MODE=all).
 */
async function preflightWebSearch() {
  if (!webSearch?.preflight) return;
  try {
    const tool = await webSearch.preflight();
    log(`Web search preflight OK (tool: ${tool})`);
  } catch (err) {
    if (DRY_RUN) throw new Error(`Web search preflight failed: ${err.message}`);
    log(`ERROR: web search preflight failed (${err.message}) — predicting WITHOUT web search this run`);
    webSearch = null;
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  log(`Agent: ${account.address}`);
  log(`Model: ${MODEL} (${LLM_PROVIDER})`);
  log(`Mode: ${MODE}`);
  log(`Lead time: ${LEAD_TIME_SECONDS}s`);
  log(`Web search: ${webSearch ? SEARCH_PROVIDER : 'disabled'}`);
  if (DRY_RUN) log(`DRY RUN — no on-chain transactions will be sent`);

  if (DRY_RUN || MODE === 'predict' || MODE === 'all') await preflightWebSearch();

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
