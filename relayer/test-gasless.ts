#!/usr/bin/env npx tsx
/**
 * End-to-end gasless relayer test.
 *
 * Usage:
 *   RELAYER_URL=https://api.foresightarena.xyz \
 *   ROUND_ID=1 \
 *   npx tsx test-gasless.ts
 *
 * This script:
 * 1. Generates an ephemeral wallet (no POL needed)
 * 2. Computes a commit hash from random predictions
 * 3. Signs an EIP-712 commit message
 * 4. POSTs it to the relayer
 * 5. Verifies the commit landed on-chain
 */

import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import {
  createPublicClient,
  http,
  keccak256,
  encodePacked,
  parseAbi,
  toHex,
} from 'viem';
import { polygon } from 'viem/chains';

const RELAYER_URL = process.env.RELAYER_URL || 'https://api.foresightarena.xyz';
const ROUND_ID = Number(process.env.ROUND_ID || '1');
const RPC_URL = process.env.RPC_URL || 'https://polygon-rpc.com';
const ARENA_ADDRESS = '0xDcEfA4c4cfF0609E43aB6CAbfeAA64ff47f33d92' as const;

const arenaAbi = parseAbi([
  'function hasCommitted(uint256,address) view returns (bool)',
  'function nonces(address) view returns (uint256)',
]);

const eip712Domain = {
  name: 'PredictionArena' as const,
  version: '1' as const,
  chainId: 137,
  verifyingContract: ARENA_ADDRESS,
};

const commitTypes = {
  Commit: [
    { name: 'roundId', type: 'uint256' },
    { name: 'commitHash', type: 'bytes32' },
    { name: 'agent', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

async function main() {
  console.log('=== Gasless Relayer E2E Test ===\n');

  // 1. Generate ephemeral wallet
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  console.log(`Agent address: ${account.address}`);
  console.log(`Agent private key: ${privateKey}`);
  console.log('(This wallet has ZERO POL)\n');

  // 2. Check relayer health
  console.log('Checking relayer health...');
  const healthResp = await fetch(`${RELAYER_URL}/health`);
  const health = await healthResp.json();
  console.log(`Relayer: ${health.relayerAddress}`);
  console.log(`Balance: ${health.balance} POL\n`);

  // 3. Compute predictions and commit hash
  const predictions = [7500]; // 75% YES on the single market
  const salt = keccak256(toHex('test-gasless-salt-' + Date.now()));

  // Tight 2-byte packing: uint256 roundId + uint16[] predictions + bytes32 salt
  let packed = encodePacked(['uint256'], [BigInt(ROUND_ID)]);
  for (const p of predictions) {
    packed = `${packed}${encodePacked(['uint16'], [p]).slice(2)}` as `0x${string}`;
  }
  const commitHash = keccak256(`${packed}${salt.slice(2)}` as `0x${string}`);

  console.log(`Round ID: ${ROUND_ID}`);
  console.log(`Predictions: [${predictions.join(', ')}] (basis points)`);
  console.log(`Salt: ${salt}`);
  console.log(`Commit hash: ${commitHash}\n`);

  // 4. Read agent nonce from contract
  const client = createPublicClient({
    chain: polygon,
    transport: http(RPC_URL),
  });

  const nonce = await client.readContract({
    address: ARENA_ADDRESS,
    abi: arenaAbi,
    functionName: 'nonces',
    args: [account.address],
  });
  console.log(`Agent nonce: ${nonce}`);

  // 5. Sign EIP-712 commit message
  const deadline = Math.floor(Date.now() / 1000) + 600; // 10 min from now

  const signature = await account.signTypedData({
    domain: eip712Domain,
    types: commitTypes,
    primaryType: 'Commit',
    message: {
      roundId: BigInt(ROUND_ID),
      commitHash,
      agent: account.address,
      nonce,
      deadline: BigInt(deadline),
    },
  });

  console.log(`Signature: ${signature.slice(0, 20)}...`);
  console.log(`Deadline: ${deadline}\n`);

  // 6. POST to relayer
  console.log('Sending to relayer...');
  const commitResp = await fetch(`${RELAYER_URL}/commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      roundId: ROUND_ID,
      commitHash,
      agent: account.address,
      deadline,
      signature,
    }),
  });

  const result = await commitResp.json();
  console.log('Relayer response:', JSON.stringify(result, null, 2));

  if (!result.success) {
    console.error('\n RELAYER FAILED:', result.error);
    process.exit(1);
  }

  console.log(`\nTx hash: ${result.txHash}`);

  // 7. Wait for tx and verify on-chain
  console.log('\nWaiting for confirmation...');
  await new Promise((r) => setTimeout(r, 5000));

  const committed = await client.readContract({
    address: ARENA_ADDRESS,
    abi: arenaAbi,
    functionName: 'hasCommitted',
    args: [BigInt(ROUND_ID), account.address],
  });

  if (committed) {
    console.log('\n=== SUCCESS: Agent committed on-chain with ZERO gas! ===');
  } else {
    console.log('\n=== PENDING: Tx submitted but not yet confirmed. Check tx hash. ===');
  }
}

main().catch((err) => {
  console.error('Error:', err.message || err);
  process.exit(1);
});
