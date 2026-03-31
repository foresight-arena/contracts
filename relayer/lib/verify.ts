import { verifyTypedData, keccak256, encodePacked } from 'viem';
import { config } from '../config.js';
import type { CommitRequest, RevealRequest } from './types.js';

const commitTypes = {
  Commit: [
    { name: 'roundId', type: 'uint256' },
    { name: 'commitHash', type: 'bytes32' },
    { name: 'agent', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

const revealTypes = {
  Reveal: [
    { name: 'roundId', type: 'uint256' },
    { name: 'predictionsHash', type: 'bytes32' },
    { name: 'salt', type: 'bytes32' },
    { name: 'agent', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

export async function verifyCommitSignature(
  req: CommitRequest,
  nonce: bigint,
): Promise<boolean> {
  const valid = await verifyTypedData({
    address: req.agent,
    domain: config.eip712Domain,
    types: commitTypes,
    primaryType: 'Commit',
    message: {
      roundId: BigInt(req.roundId),
      commitHash: req.commitHash,
      agent: req.agent,
      nonce,
      deadline: BigInt(req.deadline),
    },
    signature: req.signature,
  });
  return valid;
}

export async function verifyRevealSignature(
  req: RevealRequest,
  nonce: bigint,
): Promise<boolean> {
  // EIP-712 encodes dynamic arrays as keccak256 of packed encoding
  const predictionsHash = keccak256(
    encodePacked(
      req.predictions.map(() => 'uint16' as const),
      req.predictions.map((p) => p as unknown as bigint),
    ),
  );

  const valid = await verifyTypedData({
    address: req.agent,
    domain: config.eip712Domain,
    types: revealTypes,
    primaryType: 'Reveal',
    message: {
      roundId: BigInt(req.roundId),
      predictionsHash,
      salt: req.salt,
      agent: req.agent,
      nonce,
      deadline: BigInt(req.deadline),
    },
    signature: req.signature,
  });
  return valid;
}
