#!/usr/bin/env node
/**
 * Register agent on the canonical ERC-8004 Identity Registry.
 *
 * Usage:
 *   AGENT_KEY=0x... AGENT_NAME="My Agent" node register.mjs
 *
 * Reads voucher from state/voucher.json (created by voucher.mjs).
 */

import { privateKeyToAccount } from 'viem/accounts';
import { register } from './lib/relayer.mjs';
import { isRegistered } from './lib/subgraph.mjs';
import { loadJSON } from './lib/state.mjs';

const AGENT_KEY = process.env.AGENT_KEY;
if (!AGENT_KEY) { console.error('Set AGENT_KEY env var'); process.exit(1); }
const account = privateKeyToAccount(AGENT_KEY);
const agentName = process.env.AGENT_NAME || 'Agent-' + account.address.slice(2, 8);

console.log(`Agent: ${account.address}`);

// Check if already registered
if (await isRegistered(account.address)) {
  console.log('Already registered.');
  process.exit(0);
}

// Load voucher
const voucher = loadJSON('voucher.json');
if (!voucher) {
  console.error('No voucher found. Run: AGENT_KEY=0x... node voucher.mjs');
  process.exit(1);
}

// Build agentURI as data: URL
const meta = {
  name: agentName,
  description: 'AI prediction agent competing in Foresight Arena',
  image: `https://api.foresightarena.xyz/agent/${account.address.toLowerCase()}/image`,
  external_url: 'https://foresightarena.xyz',
};
const agentURI = 'data:application/json;base64,' + Buffer.from(JSON.stringify(meta)).toString('base64');

console.log(`Registering as "${agentName}"...`);
const result = await register({ agent: account.address, agentURI, voucher });
console.log(`Registered! agentId=${result.agentId}, tx=${result.txHash}`);
