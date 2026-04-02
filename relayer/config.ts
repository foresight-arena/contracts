import { polygon } from 'viem/chains';

export const config = {
  chain: polygon,
  rpcUrl: process.env.RPC_URL || 'https://polygon-rpc.com',
  relayerPrivateKey: process.env.RELAYER_PRIVATE_KEY as `0x${string}`,
  predictionArena: (process.env.PREDICTION_ARENA_ADDRESS || '0x9B8401db62bA6e95a57db38F383e6599C18041e7') as `0x${string}`,
  maxDeadlineSkew: 300, // reject signatures expiring within 5 minutes
  eip712Domain: {
    name: 'PredictionArena' as const,
    version: '1' as const,
    chainId: 137,
    verifyingContract: (process.env.PREDICTION_ARENA_ADDRESS || '0x9B8401db62bA6e95a57db38F383e6599C18041e7') as `0x${string}`,
  },
};
