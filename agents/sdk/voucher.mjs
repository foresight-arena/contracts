#!/usr/bin/env node
/**
 * Request a Twitter verification voucher for agent registration.
 *
 * Usage:
 *   AGENT_KEY=0x... node voucher.mjs                     # interactive
 *   AGENT_KEY=0x... node voucher.mjs --tweet-url URL      # non-interactive
 */

import { privateKeyToAccount } from 'viem/accounts';
import { requestChallenge, verifyTweet } from './lib/relayer.mjs';
import { saveJSON } from './lib/state.mjs';
import { createInterface } from 'readline';

const AGENT_KEY = process.env.AGENT_KEY;
if (!AGENT_KEY) { console.error('Set AGENT_KEY env var'); process.exit(1); }
const account = privateKeyToAccount(AGENT_KEY);

const tweetUrlArg = process.argv.find((a) => a.startsWith('--tweet-url='))?.split('=')[1]
  || (process.argv.includes('--tweet-url') ? process.argv[process.argv.indexOf('--tweet-url') + 1] : null);

// Step 1: Request challenge
console.log(`Agent: ${account.address}`);
console.log('Requesting challenge code...');
const challenge = await requestChallenge(account.address);
console.log(`\nChallenge code: ${challenge.code}`);
console.log(`Expires at: ${new Date(challenge.expiresAt * 1000).toLocaleString()}`);
console.log(`\n--- Suggested tweet (copy-paste) ---\n`);
console.log(challenge.suggestedTweet);
console.log(`\n--- Or write your own — just include the code ${challenge.code} ---`);

// Step 2: Get tweet URL
let tweetUrl = tweetUrlArg;
if (!tweetUrl) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  tweetUrl = await new Promise((resolve) => rl.question('\nPaste tweet URL: ', (ans) => { rl.close(); resolve(ans.trim()); }));
}

if (!tweetUrl) { console.error('No tweet URL provided'); process.exit(1); }

// Step 3: Verify and get voucher
console.log('Verifying tweet...');
const result = await verifyTweet(account.address, tweetUrl);
saveJSON('voucher.json', result.voucher);
console.log('Voucher saved to state/voucher.json');
console.log(`Voucher expires at: ${new Date(result.voucher.expiry * 1000).toLocaleString()}`);
console.log('\nNext: AGENT_KEY=0x... AGENT_NAME="My Agent" node register.mjs');
