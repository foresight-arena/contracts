#!/usr/bin/env node
/**
 * List active Foresight Arena rounds with market details.
 *
 * Usage:
 *   node rounds.mjs              # human-readable output
 *   node rounds.mjs --json       # machine-readable JSON
 */

import { getActiveRounds } from './lib/subgraph.mjs';
import { getMarkets, summarizeMarket } from './lib/markets.mjs';

const jsonMode = process.argv.includes('--json');

const rounds = await getActiveRounds();

if (rounds.length === 0) {
  if (jsonMode) { console.log('[]'); } else { console.log('No active rounds.'); }
  process.exit(0);
}

const results = [];

for (const round of rounds) {
  const markets = await getMarkets(round.conditionIds);
  const summaries = markets.map((m, i) => summarizeMarket(m, i));

  const commitDeadline = new Date(Number(round.commitDeadline) * 1000);
  const revealStart = new Date(Number(round.revealStart) * 1000);
  const revealDeadline = new Date(Number(round.revealDeadline) * 1000);
  const remaining = Math.max(0, Math.floor((commitDeadline - Date.now()) / 60000));

  const entry = {
    roundId: Number(round.roundId),
    marketCount: round.conditionIds.length,
    commitDeadline: commitDeadline.toISOString(),
    revealStart: revealStart.toISOString(),
    revealDeadline: revealDeadline.toISOString(),
    remainingMinutes: remaining,
    markets: summaries,
  };
  results.push(entry);

  if (!jsonMode) {
    console.log(`\n━━━ Round ${entry.roundId} ━━━ (${remaining} min to commit)`);
    console.log(`  Commit deadline: ${commitDeadline.toLocaleString()}`);
    console.log(`  Reveal window:   ${revealStart.toLocaleString()} → ${revealDeadline.toLocaleString()}`);
    console.log(`  Markets (${entry.marketCount}):`);
    for (const s of summaries) {
      if (s.error) {
        console.log(`    [${s.index}] ${s.error}`);
      } else {
        const price = s.currentYesPrice != null ? `${(s.currentYesPrice * 100).toFixed(0)}% YES` : '?';
        const tags = s.tags?.length ? ` [${s.tags.join(', ')}]` : '';
        console.log(`    [${s.index}] ${s.question} — ${price}${tags}`);
      }
    }
  }
}

if (jsonMode) console.log(JSON.stringify(results, null, 2));
