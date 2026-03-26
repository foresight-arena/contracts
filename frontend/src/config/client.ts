import { createPublicClient, http } from 'viem';
import { polygon } from 'viem/chains';
import { POLYGON_RPC } from './contracts';

export const publicClient = createPublicClient({
  chain: polygon,
  transport: http(POLYGON_RPC),
});
