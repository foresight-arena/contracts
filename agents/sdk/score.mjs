#!/usr/bin/env node
/**
 * Check agent scores.
 *
 * Usage:
 *   AGENT_KEY=0x... node score.mjs              # all scored rounds
 *   AGENT_KEY=0x... node score.mjs --round 7    # specific round
 */

import { privateKeyToAccount } from 'viem/accounts';
import { getScore, getAllScores } from './lib/subgraph.mjs';

const AGENT_KEY = process.env.AGENT_KEY;
if (!AGENT_KEY) { console.error('Set AGENT_KEY env var'); process.exit(1); }
const account = privateKeyToAccount(AGENT_KEY);

const roundArg = process.argv.find((a) => a.startsWith('--round='))?.split('=')[1]
  || (process.argv.includes('--round') ? process.argv[process.argv.indexOf('--round') + 1] : null);

function fmt(score) {
  const brier = ((Number(score.brierScore) / 1e8) * 100).toFixed(2);
  const alpha = ((Number(score.alphaScore) / 1e8) * 100).toFixed(2);
  return `Brier: ${brier}% (lower=better)  Alpha: ${alpha}% (higher=better)  Markets: ${score.scoredMarkets}/${score.totalMarkets}`;
}

console.log(`Agent: ${account.address}\n`);

if (roundArg) {
  const score = await getScore(roundArg, account.address);
  if (!score) { console.log(`No data for round ${roundArg}.`); process.exit(0); }
  if (score.scoredMarkets === 0) {
    console.log(`Round ${roundArg}: ${score.revealed ? 'Revealed, waiting for outcomes trigger.' : 'Not revealed.'}`);
  } else {
    console.log(`Round ${roundArg}: ${fmt(score)}`);
  }
} else {
  const scores = await getAllScores(account.address);
  if (scores.length === 0) { console.log('No scored rounds yet.'); process.exit(0); }
  for (const s of scores) {
    console.log(`Round ${s.round.roundId}: ${fmt(s)}`);
  }
  // Summary
  const total = scores.length;
  const avgBrier = scores.reduce((sum, s) => sum + Number(s.brierScore), 0) / total;
  const avgAlpha = scores.reduce((sum, s) => sum + Number(s.alphaScore), 0) / total;
  console.log(`\nOverall (${total} rounds): Avg Brier ${((avgBrier / 1e8) * 100).toFixed(2)}%  Avg Alpha ${((avgAlpha / 1e8) * 100).toFixed(2)}%`);
}
