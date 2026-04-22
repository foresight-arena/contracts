import { keccak256 } from 'viem';
import { packPredictions } from './crypto.mjs';
import { getNonce } from './subgraph.mjs';

const RELAYER = process.env.RELAYER_URL || 'https://api.foresightarena.xyz';
const ARENA = '0xB81e4F6D37f036508F584B8e9Cc1dceA096D554d';

const EIP712_DOMAIN = {
  name: 'PredictionArena',
  version: '1',
  chainId: 137,
  verifyingContract: ARENA,
};

const COMMIT_TYPES = {
  Commit: [
    { name: 'roundId', type: 'uint256' },
    { name: 'commitHash', type: 'bytes32' },
    { name: 'reasoningHash', type: 'bytes32' },
    { name: 'agent', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
};

const REVEAL_TYPES = {
  Reveal: [
    { name: 'roundId', type: 'uint256' },
    { name: 'predictionsHash', type: 'bytes32' },
    { name: 'salt', type: 'bytes32' },
    { name: 'agent', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
};

async function post(path, body) {
  const resp = await fetch(`${RELAYER}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || `Relayer ${path} failed: ${resp.status}`);
  return data;
}

export async function gaslessCommit({ roundId, commitHash, reasoningHash, account }) {
  const nonce = await getNonce(account.address);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  const rh = reasoningHash || '0x' + '00'.repeat(32);

  const signature = await account.signTypedData({
    domain: EIP712_DOMAIN,
    types: COMMIT_TYPES,
    primaryType: 'Commit',
    message: {
      roundId: BigInt(roundId),
      commitHash,
      reasoningHash: rh,
      agent: account.address,
      nonce,
      deadline,
    },
  });

  return post('/commit', {
    roundId: Number(roundId),
    commitHash,
    reasoningHash: rh,
    agent: account.address,
    deadline: Number(deadline),
    signature,
  });
}

export async function gaslessReveal({ roundId, predictions, salt, account }) {
  const nonce = await getNonce(account.address);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  const predictionsHash = keccak256(packPredictions(predictions));

  const signature = await account.signTypedData({
    domain: EIP712_DOMAIN,
    types: REVEAL_TYPES,
    primaryType: 'Reveal',
    message: {
      roundId: BigInt(roundId),
      predictionsHash,
      salt,
      agent: account.address,
      nonce,
      deadline,
    },
  });

  return post('/reveal', {
    roundId: Number(roundId),
    predictions,
    salt,
    agent: account.address,
    deadline: Number(deadline),
    signature,
  });
}

export async function register({ agent, agentURI, voucher }) {
  return post('/register', { agent, agentURI, voucher });
}

export async function requestChallenge(agent) {
  return post('/voucher/challenge', { agent });
}

export async function verifyTweet(agent, tweetUrl) {
  return post('/voucher/verify', { agent, tweetUrl });
}
