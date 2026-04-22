#!/usr/bin/env node
/**
 * Gasless reveal — processes the reveal queue.
 *
 * Usage:
 *   AGENT_KEY=0x... node reveal.mjs              # process all queued reveals
 *   AGENT_KEY=0x... node reveal.mjs --round 7    # reveal specific round only
 */

import { privateKeyToAccount } from 'viem/accounts';
import { gaslessReveal } from './lib/relayer.mjs';
import { getRound } from './lib/subgraph.mjs';
import { getRevealQueue, saveRevealQueue } from './lib/state.mjs';

const AGENT_KEY = process.env.AGENT_KEY;
if (!AGENT_KEY) { console.error('Set AGENT_KEY env var'); process.exit(1); }
const account = privateKeyToAccount(AGENT_KEY);

const roundFilter = process.argv.find((a) => a.startsWith('--round='))?.split('=')[1]
  || (process.argv.includes('--round') ? process.argv[process.argv.indexOf('--round') + 1] : null);

const queue = getRevealQueue();
if (queue.length === 0) { console.log('Reveal queue is empty.'); process.exit(0); }

const remaining = [];
let revealed = 0;

for (const entry of queue) {
  if (roundFilter && String(entry.roundId) !== roundFilter) {
    remaining.push(entry);
    continue;
  }

  const round = await getRound(entry.roundId);
  if (!round) { console.log(`Round ${entry.roundId}: not found, dropping`); continue; }

  const now = Math.floor(Date.now() / 1000);
  if (round.invalidated) { console.log(`Round ${entry.roundId}: invalidated, dropping`); continue; }
  if (now >= Number(round.revealDeadline)) { console.log(`Round ${entry.roundId}: reveal deadline passed, dropping`); continue; }
  if (now < Number(round.revealStart)) {
    const mins = Math.ceil((Number(round.revealStart) - now) / 60);
    console.log(`Round ${entry.roundId}: reveal not open yet (${mins} min remaining)`);
    remaining.push(entry);
    continue;
  }

  console.log(`Round ${entry.roundId}: revealing [${entry.predictions.join(', ')}]...`);
  try {
    const result = await gaslessReveal({
      roundId: entry.roundId,
      predictions: entry.predictions,
      salt: entry.salt,
      account,
    });
    console.log(`  Revealed! tx=${result.txHash}`);
    revealed++;
  } catch (err) {
    if (err.message?.includes('Already revealed')) {
      console.log(`  Already revealed, dropping.`);
    } else {
      console.error(`  Error: ${err.message}`);
      remaining.push(entry);
    }
  }
}

saveRevealQueue(remaining);
console.log(`\nRevealed: ${revealed}, remaining in queue: ${remaining.length}`);
if (revealed > 0) console.log('Scores appear after curator triggers outcomes.');
