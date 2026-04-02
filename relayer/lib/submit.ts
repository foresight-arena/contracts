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
  'function commitWithSignature(uint256 roundId, bytes32 commitHash, address agent, uint256 deadline, bytes signature) external',
  'function revealWithSignature(uint256 roundId, uint16[] predictions, bytes32 salt, address agent, uint256 deadline, bytes signature) external',
  'function nonces(address) view returns (uint256)',
]);

const registryAbi = parseAbi([
  'function registerAgentWithSignature(address agent, string name, string url, address owner, bytes signature) external',
  'function isRegistered(address agent) view returns (bool)',
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
  // Simulate first — reverts here cost no gas
  const { request } = await publicClient.simulateContract({
    address: config.predictionArena,
    abi,
    functionName: 'commitWithSignature',
    args: [
      BigInt(req.roundId),
      req.commitHash,
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

const REGISTRY = (process.env.AGENT_REGISTRY_ADDRESS || '0x624C60c4a3c7461909412FF9b7A0216d4cB0e637') as `0x${string}`;

export async function isAgentRegistered(agent: `0x${string}`): Promise<boolean> {
  return publicClient!.readContract({
    address: REGISTRY,
    abi: registryAbi,
    functionName: 'isRegistered',
    args: [agent],
  }) as Promise<boolean>;
}

export async function submitRegister(
  agent: `0x${string}`,
  name: string,
  url: string,
  signature: `0x${string}`,
): Promise<string> {
  const { request } = await publicClient!.simulateContract({
    address: REGISTRY,
    abi: registryAbi,
    functionName: 'registerAgentWithSignature',
    args: [agent, name, url, agent, signature],
    account: walletClient!.account!,
  });

  const txHash = await walletClient!.writeContract(request);
  return txHash;
}
