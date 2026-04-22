import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
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

// Canonical ERC-8004 Identity Registry — same address on all chains
const IDENTITY_REGISTRY_ADDRESS = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' as const;

const identityRegistryAbi = parseAbi([
  'function register() returns (uint256)',
  'function register(string agentURI) returns (uint256)',
  'function setAgentURI(uint256 agentId, string newURI)',
  'function transferFrom(address from, address to, uint256 tokenId)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function balanceOf(address owner) view returns (uint256)',
  'event Registered(uint256 indexed agentId, address indexed owner, string agentURI)',
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
  // Canonical Identity Registry has no agentIdOf view — use standard ERC-721 balanceOf
  const balance = await publicClient!.readContract({
    address: IDENTITY_REGISTRY_ADDRESS,
    abi: identityRegistryAbi,
    functionName: 'balanceOf',
    args: [agent],
  }) as bigint;
  return balance > 0n;
}

/**
 * Register an agent on the canonical ERC-8004 Identity Registry and transfer
 * the minted NFT to the agent. Two-tx flow since the canonical registry mints
 * to msg.sender (the relayer) with no signature-based registration path.
 *
 * 1. relayer calls register(agentURI) — mints agentId to relayer
 * 2. parse Registered event for the new agentId
 * 3. relayer calls transferFrom(relayer, agent, agentId)
 */
export async function submitRegister(
  agent: `0x${string}`,
  agentURI: string,
): Promise<{ txHash: string; agentId: bigint }> {
  // Step 1: mint to relayer
  const { request: mintRequest } = await publicClient!.simulateContract({
    address: IDENTITY_REGISTRY_ADDRESS,
    abi: identityRegistryAbi,
    functionName: 'register',
    args: [agentURI],
    account: walletClient!.account!,
  });
  const mintTxHash = await walletClient!.writeContract(mintRequest);

  // Step 2: wait for receipt and parse Registered event to learn the agentId
  const receipt = await publicClient!.waitForTransactionReceipt({ hash: mintTxHash });

  let agentId: bigint | null = null;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== IDENTITY_REGISTRY_ADDRESS.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({
        abi: identityRegistryAbi,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName === 'Registered') {
        agentId = (decoded.args as { agentId: bigint }).agentId;
        break;
      }
    } catch {
      // Not a Registered event — skip
    }
  }
  if (agentId == null) {
    throw new Error('Failed to parse Registered event from mint receipt');
  }

  // Step 3: transfer the freshly-minted NFT from the relayer to the agent
  const { request: transferRequest } = await publicClient!.simulateContract({
    address: IDENTITY_REGISTRY_ADDRESS,
    abi: identityRegistryAbi,
    functionName: 'transferFrom',
    args: [relayerAddress, agent, agentId],
    account: walletClient!.account!,
  });
  const transferTxHash = await walletClient!.writeContract(transferRequest);
  await publicClient!.waitForTransactionReceipt({ hash: transferTxHash });

  return { txHash: transferTxHash, agentId };
}

/**
 * Recover a stranded mint — transfer an NFT that the relayer owns to the intended agent.
 * Used when step 3 of submitRegister failed (timeout, RPC blip, nonce race).
 */
export async function recoverStrandedMint(
  agent: `0x${string}`,
  agentId: bigint,
): Promise<string> {
  // Verify the relayer actually owns this token
  const owner = await publicClient!.readContract({
    address: IDENTITY_REGISTRY_ADDRESS,
    abi: identityRegistryAbi,
    functionName: 'ownerOf',
    args: [agentId],
  }) as `0x${string}`;

  if (owner.toLowerCase() !== relayerAddress.toLowerCase()) {
    throw new Error(`Relayer does not own agentId ${agentId} (owner: ${owner})`);
  }

  const { request } = await publicClient!.simulateContract({
    address: IDENTITY_REGISTRY_ADDRESS,
    abi: identityRegistryAbi,
    functionName: 'transferFrom',
    args: [relayerAddress, agent, agentId],
    account: walletClient!.account!,
  });
  const txHash = await walletClient!.writeContract(request);
  await publicClient!.waitForTransactionReceipt({ hash: txHash });
  return txHash;
}
