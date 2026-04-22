#!/usr/bin/env node
/**
 * Gasless commit to a Foresight Arena round.
 *
 * Usage:
 *   AGENT_KEY=0x... node commit.mjs --round 7                               # reads predictions from state/
 *   AGENT_KEY=0x... node commit.mjs --round 7 --predictions "7500,3000,8500" # manual predictions
 */

import { privateKeyToAccount } from 'viem/accounts';
import { computeCommitHash, generateSalt } from './lib/crypto.mjs';
import { gaslessCommit } from './lib/relayer.mjs';
import { getRound } from './lib/subgraph.mjs';
import { loadJSON, saveJSON, getRevealQueue, saveRevealQueue } from './lib/state.mjs';

const AGENT_KEY = process.env.AGENT_KEY;
if (!AGENT_KEY) { console.error('Set AGENT_KEY env var'); process.exit(1); }
const account = privateKeyToAccount(AGENT_KEY);

// Parse args
const roundIdArg = process.argv.find((a) => a.startsWith('--round='))?.split('=')[1]
  || (process.argv.includes('--round') ? process.argv[process.argv.indexOf('--round') + 1] : null);
const predsArg = process.argv.find((a) => a.startsWith('--predictions='))?.split('=')[1]
  || (process.argv.includes('--predictions') ? process.argv[process.argv.indexOf('--predictions') + 1] : null);

if (!roundIdArg) { console.error('Usage: node commit.mjs --round <id> [--predictions "7500,3000"]'); process.exit(1); }
const roundId = Number(roundIdArg);

// Load predictions
let predictions;
if (predsArg) {
  predictions = predsArg.split(',').map(Number);
} else {
  const saved = loadJSON(`predictions-${roundId}.json`);
  if (saved?.predictions) {
    predictions = saved.predictions;
  } else {
    console.error(`No predictions found. Run: node predict.mjs --round ${roundId}`);
    console.error('Or pass inline: node commit.mjs --round ' + roundId + ' --predictions "7500,3000"');
    process.exit(1);
  }
}

// Verify round exists and is in commit phase
const round = await getRound(roundId);
if (!round) { console.error(`Round ${roundId} not found`); process.exit(1); }
const now = Math.floor(Date.now() / 1000);
if (now >= Number(round.commitDeadline)) { console.error('Commit phase has ended'); process.exit(1); }
if (round.invalidated) { console.error('Round is invalidated'); process.exit(1); }
if (predictions.length !== round.conditionIds.length) {
  console.error(`Expected ${round.conditionIds.length} predictions, got ${predictions.length}`);
  process.exit(1);
}

// Commit
const salt = generateSalt();
const commitHash = computeCommitHash(roundId, predictions, salt);

console.log(`Agent: ${account.address}`);
console.log(`Round: ${roundId} (${predictions.length} markets)`);
console.log(`Predictions: [${predictions.join(', ')}]`);
console.log(`Salt: ${salt}`);
console.log(`Commit hash: ${commitHash}`);
console.log('Submitting gasless commit...');

const result = await gaslessCommit({ roundId, commitHash, account });
console.log(`Committed! tx=${result.txHash}`);

// Save to reveal queue
const queue = getRevealQueue();
queue.push({ roundId, predictions, salt, commitHash, committedAt: new Date().toISOString() });
saveRevealQueue(queue);
console.log('Saved to reveal queue.');
console.log(`\nNext: wait for reveal phase, then run: AGENT_KEY=0x... node reveal.mjs`);
