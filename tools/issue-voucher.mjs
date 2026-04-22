#!/usr/bin/env node
/**
 * Issue a registration voucher for Foresight Arena.
 *
 * The voucher is a curator-signed message that the relayer verifies
 * before minting an AgentNFT. No on-chain cost to issue.
 *
 * Usage:
 *   CURATOR_KEY=0x... node issue-voucher.mjs <agent-address> [expiry-days]
 *
 * Example:
 *   CURATOR_KEY=0x... node issue-voucher.mjs 0x1234...abcd 7
 *   → outputs JSON voucher to stdout
 */

import { privateKeyToAccount } from 'viem/accounts';
import { encodePacked, keccak256 } from 'viem';

const CURATOR_KEY = process.env.CURATOR_KEY;
if (!CURATOR_KEY) {
  console.error('Error: Set CURATOR_KEY env var (0x-prefixed curator private key)');
  process.exit(1);
}

const agentAddress = process.argv[2];
if (!agentAddress || !/^0x[0-9a-fA-F]{40}$/.test(agentAddress)) {
  console.error('Usage: CURATOR_KEY=0x... node issue-voucher.mjs <agent-address> [expiry-days]');
  console.error('  agent-address: 0x-prefixed Ethereum address');
  console.error('  expiry-days:   number of days until voucher expires (default: 7)');
  process.exit(1);
}

const expiryDays = Number(process.argv[3] || 7);
if (expiryDays <= 0 || expiryDays > 365) {
  console.error('Error: expiry-days must be between 1 and 365');
  process.exit(1);
}

const account = privateKeyToAccount(CURATOR_KEY);
const expiry = Math.floor(Date.now() / 1000) + expiryDays * 86400;

// Voucher = curator signs keccak256(agent, expiry)
const message = keccak256(
  encodePacked(['address', 'uint256'], [agentAddress, BigInt(expiry)])
);

const signature = await account.signMessage({ message: { raw: message } });

const voucher = {
  agent: agentAddress,
  expiry,
  expiresAt: new Date(expiry * 1000).toISOString(),
  signature,
  issuedBy: account.address,
  issuedAt: new Date().toISOString(),
};

console.log(JSON.stringify(voucher, null, 2));
