import { createPublicClient, http } from 'viem';
import { polygon } from 'viem/chains';
import { POLYGON_RPC } from './contracts';

const rpcUrl = import.meta.env.VITE_RPC_URL || POLYGON_RPC;

export const publicClient = createPublicClient({
  chain: polygon,
  transport: http(rpcUrl),
});
