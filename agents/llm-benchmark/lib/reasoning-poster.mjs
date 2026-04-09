/**
 * Posts agent reasoning to the relayer's /reasoning endpoint.
 * Signs the payload with EIP-712 so the relayer can verify the agent identity.
 *
 * Set RELAYER_URL to enable. The agent must be on the relayer's whitelist.
 */

import { keccak256, toBytes } from 'viem';

const REASONING_TYPES = {
  ReasoningPost: [
    { name: 'roundId', type: 'uint256' },
    { name: 'agent', type: 'address' },
    { name: 'contentHash', type: 'bytes32' },
    { name: 'deadline', type: 'uint256' },
  ],
};

/**
 * Canonical JSON serialization — sorted keys, matches relayer's canonicalize().
 */
export function canonicalize(content) {
  if (content === null || typeof content !== 'object') return JSON.stringify(content);
  if (Array.isArray(content)) return '[' + content.map(canonicalize).join(',') + ']';
  const keys = Object.keys(content).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize(content[k])).join(',') + '}';
}

export async function postReasoning({ relayerUrl, account, arenaAddress, roundId, content }) {
  const json = canonicalize(content);
  const contentHash = keccak256(toBytes(json));
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);

  const signature = await account.signTypedData({
    domain: {
      name: 'PredictionArena',
      version: '1',
      chainId: 137,
      verifyingContract: arenaAddress,
    },
    types: REASONING_TYPES,
    primaryType: 'ReasoningPost',
    message: {
      roundId: BigInt(roundId),
      agent: account.address,
      contentHash,
      deadline,
    },
  });

  const resp = await fetch(`${relayerUrl}/reasoning`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      roundId: Number(roundId),
      agent: account.address,
      content,
      deadline: Number(deadline),
      signature,
    }),
  });

  const data = await resp.json();
  if (!resp.ok || !data.success) {
    throw new Error(`Reasoning post failed: ${data.error || resp.status}`);
  }
  return data;
}
