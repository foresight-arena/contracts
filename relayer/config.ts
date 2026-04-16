import { polygon } from 'viem/chains';

export const config = {
  chain: polygon,
  rpcUrl: process.env.RPC_URL || 'https://polygon-rpc.com',
  relayerPrivateKey: process.env.RELAYER_PRIVATE_KEY as `0x${string}`,
  predictionArena: (process.env.PREDICTION_ARENA_ADDRESS || '0x5f28d56B4aBBE662c29755701C4a5f801Ace9D2a') as `0x${string}`,
  agentNFT: (process.env.AGENT_NFT_ADDRESS || '0x0000000000000000000000000000000000000000') as `0x${string}`,
  curatorAddress: (process.env.CURATOR_ADDRESS || '0x0000000000000000000000000000000000000000') as `0x${string}`,
  maxDeadlineSkew: 300, // reject signatures expiring within 5 minutes
  eip712Domain: {
    name: 'PredictionArena' as const,
    version: '1' as const,
    chainId: 137,
    verifyingContract: (process.env.PREDICTION_ARENA_ADDRESS || '0x5f28d56B4aBBE662c29755701C4a5f801Ace9D2a') as `0x${string}`,
  },
};
