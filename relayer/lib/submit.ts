import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  type PublicClient,
  type WalletClient,
  type Chain,
  formatEther,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { config } from '../config.js';
import type { CommitRequest, RevealRequest } from './types.js';

const abi = parseAbi([
  'function commitWithSignature(uint256 roundId, bytes32 commitHash, bytes32 reasoningHash, address agent, uint256 deadline, bytes signature) external',
  'function revealWithSignature(uint256 roundId, uint16[] predictions, bytes32 salt, address agent, uint256 deadline, bytes signature) external',
  'function nonces(address) view returns (uint256)',
  'function triggerOutcomes(uint256 roundId) external',
  'function triggerOutcomesAndScore(uint256 roundId) external',
  'function calculateScoresForPendingReveals(uint256 roundId) external',
  'function getRoundOutcomes(uint256 roundId) view returns (bool triggered, uint256 bitmask, int256[] outcomes)',
  'function getPendingScoringCount(uint256 roundId) view returns (uint256)',
]);

const agentNFTAbi = parseAbi([
  'function registerWithSignature(address agent, string name, string url, string model, uint256 nonce, uint256 deadline, bytes signature) external',
  'function agentIdOf(address agent) view returns (uint256)',
  'function nonces(address) view returns (uint256)',
]);

let publicClient: PublicClient | null = null;
let walletClient: WalletClient | null = null;
let relayerAddress: `0x${string}` = '0x0000000000000000000000000000000000000000';

export function init() {
  if (!config.relayerPrivateKey) {
    throw new Error('RELAYER_PRIVATE_KEY not set');
  }
  const account = privateKeyToAccount(config.relayerPrivateKey);
  relayerAddress = account.address;

  publicClient = createPublicClient({
    chain: config.chain as Chain,
    transport: http(config.rpcUrl),
  });

  walletClient = createWalletClient({
    account,
    chain: config.chain as Chain,
    transport: http(config.rpcUrl),
  });
}

export function getRelayerAddress(): `0x${string}` {
  return relayerAddress;
}

export async function getRelayerBalance(): Promise<string> {
  const balance = await publicClient.getBalance({ address: relayerAddress });
  return formatEther(balance);
}

export async function getAgentNonce(agent: `0x${string}`): Promise<bigint> {
  return publicClient.readContract({
    address: config.predictionArena,
    abi,
    functionName: 'nonces',
    args: [agent],
  }) as Promise<bigint>;
}

export async function submitCommit(req: CommitRequest): Promise<string> {
  const reasoningHash = req.reasoningHash || '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`;
  // Simulate first — reverts here cost no gas
  const { request } = await publicClient.simulateContract({
    address: config.predictionArena,
    abi,
    functionName: 'commitWithSignature',
    args: [
      BigInt(req.roundId),
      req.commitHash,
      reasoningHash,
      req.agent,
      BigInt(req.deadline),
      req.signature,
    ],
    account: walletClient.account!,
  });

  const txHash = await walletClient.writeContract(request);
  return txHash;
}

export async function submitReveal(req: RevealRequest): Promise<string> {
  const { request } = await publicClient!.simulateContract({
    address: config.predictionArena,
    abi,
    functionName: 'revealWithSignature',
    args: [
      BigInt(req.roundId),
      req.predictions.map((p) => p),
      req.salt,
      req.agent,
      BigInt(req.deadline),
      req.signature,
    ],
    account: walletClient!.account!,
  });

  const txHash = await walletClient!.writeContract(request);
  return txHash;
}

export async function submitTriggerOutcomesAndScore(roundId: number): Promise<string> {
  const { request } = await publicClient!.simulateContract({
    address: config.predictionArena,
    abi,
    functionName: 'triggerOutcomesAndScore',
    args: [BigInt(roundId)],
    account: walletClient!.account!,
  });
  return walletClient!.writeContract(request);
}

export async function submitCalculateScores(roundId: number): Promise<string> {
  const { request } = await publicClient!.simulateContract({
    address: config.predictionArena,
    abi,
    functionName: 'calculateScoresForPendingReveals',
    args: [BigInt(roundId)],
    account: walletClient!.account!,
  });
  return walletClient!.writeContract(request);
}

export async function isOutcomesTriggered(roundId: number): Promise<boolean> {
  const [triggered] = await publicClient!.readContract({
    address: config.predictionArena,
    abi,
    functionName: 'getRoundOutcomes',
    args: [BigInt(roundId)],
  }) as [boolean, bigint, bigint[]];
  return triggered;
}

export async function getPendingCount(roundId: number): Promise<bigint> {
  return publicClient!.readContract({
    address: config.predictionArena,
    abi,
    functionName: 'getPendingScoringCount',
    args: [BigInt(roundId)],
  }) as Promise<bigint>;
}

export async function isAgentRegistered(agent: `0x${string}`): Promise<boolean> {
  const agentId = await publicClient!.readContract({
    address: config.agentNFT,
    abi: agentNFTAbi,
    functionName: 'agentIdOf',
    args: [agent],
  }) as bigint;
  return agentId > 0n;
}

export async function getAgentNFTNonce(agent: `0x${string}`): Promise<bigint> {
  return publicClient!.readContract({
    address: config.agentNFT,
    abi: agentNFTAbi,
    functionName: 'nonces',
    args: [agent],
  }) as Promise<bigint>;
}

export async function submitRegister(
  agent: `0x${string}`,
  name: string,
  url: string,
  model: string,
  nonce: bigint,
  deadline: bigint,
  signature: `0x${string}`,
): Promise<string> {
  const { request } = await publicClient!.simulateContract({
    address: config.agentNFT,
    abi: agentNFTAbi,
    functionName: 'registerWithSignature',
    args: [agent, name, url, model, nonce, deadline, signature],
    account: walletClient!.account!,
  });

  const txHash = await walletClient!.writeContract(request);
  return txHash;
}
