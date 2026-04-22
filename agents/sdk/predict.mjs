#!/usr/bin/env node
/**
 * LLM-powered predictions via OpenRouter.
 *
 * Usage:
 *   AGENT_KEY=0x... MODEL=anthropic/claude-sonnet-4 OPENROUTER_API_KEY=sk-or-... node predict.mjs --round 7
 *   TAVILY_API_KEY=tvly-... to enable web search
 */

import { getRound } from './lib/subgraph.mjs';
import { getMarkets, summarizeMarket } from './lib/markets.mjs';
import { buildPrompt, createTools, getPredictions } from './lib/predict.mjs';
import { saveJSON } from './lib/state.mjs';

const MODEL = process.env.MODEL;
if (!MODEL) { console.error('Set MODEL env var (e.g. anthropic/claude-sonnet-4)'); process.exit(1); }

const roundArg = process.argv.find((a) => a.startsWith('--round='))?.split('=')[1]
  || (process.argv.includes('--round') ? process.argv[process.argv.indexOf('--round') + 1] : null);
if (!roundArg) { console.error('Usage: node predict.mjs --round <id>'); process.exit(1); }
const roundId = Number(roundArg);

// Fetch round + markets
const round = await getRound(roundId);
if (!round) { console.error(`Round ${roundId} not found`); process.exit(1); }

console.log(`Round ${roundId}: ${round.conditionIds.length} markets`);
console.log('Fetching market data...');

const marketsRaw = await getMarkets(round.conditionIds);
const summaries = marketsRaw.map((m, i) => summarizeMarket(m, i));

for (const s of summaries) {
  const price = s.currentYesPrice != null ? `${(s.currentYesPrice * 100).toFixed(0)}% YES` : '?';
  console.log(`  [${s.index}] ${s.question || s.error} — ${price}`);
}

// Build prompt + tools
const tavilyKey = process.env.TAVILY_API_KEY || '';
const prompt = buildPrompt({ roundId, round, summaries, hasWebSearch: !!tavilyKey });
const baseTools = await createTools({ marketsRaw, tavilyKey });

// Call LLM
console.log(`\nCalling ${MODEL}...`);
const result = await getPredictions({
  model: MODEL,
  prompt,
  baseTools,
  marketCount: round.conditionIds.length,
});

console.log('\nPredictions:');
for (const p of result.perMarketReasoning) {
  const s = summaries[p.marketIndex];
  console.log(`  [${p.marketIndex}] ${(p.probabilityBps / 100).toFixed(0)}% — ${p.reasoning}`);
}

if (result.usage) {
  console.log(`\nTokens: ${result.usage.promptTokens} in / ${result.usage.completionTokens} out`);
}

// Save
saveJSON(`predictions-${roundId}.json`, { roundId, model: MODEL, predictions: result.predictions, perMarketReasoning: result.perMarketReasoning, timestamp: new Date().toISOString() });
console.log(`\nSaved to state/predictions-${roundId}.json`);
console.log(`Next: AGENT_KEY=0x... node commit.mjs --round ${roundId}`);
