export type ContractSetName = 'fast' | 'production';

export interface ContractAddresses {
  roundManager: `0x${string}`;
  predictionArena: `0x${string}`;
  agentRegistry: `0x${string}`;
  gasRebate: `0x${string}`;
  deployBlock: bigint; // block to start scanning events from
}

export const CONTRACT_SETS: Record<ContractSetName, ContractAddresses> = {
  fast: {
    // Polygon Mainnet fast version addresses
    roundManager: '0xa2303C1FbFD8dD556355eE9E33Bb899759907d78',
    predictionArena: '0x5D0aFAb396CA23d25e2Bd703c9736aC095be8eB6',
    agentRegistry: '0x669734f7f6dd2a5616fE910e172366B267DfCF7E',
    gasRebate: '0xaF97f527a9D324bBe891C3814a3160296fAdaB00',
    deployBlock: 84710000n, // deploy block (contracts deployed at ~84710800)
  },
  production: {
    // placeholder — not yet deployed with production RoundManager
    roundManager: '0x0000000000000000000000000000000000000000',
    predictionArena: '0x0000000000000000000000000000000000000000',
    agentRegistry: '0x0000000000000000000000000000000000000000',
    gasRebate: '0x0000000000000000000000000000000000000000',
    deployBlock: 0n,
  },
};

export const POLYGON_CHAIN_ID = 137;
export const POLYGON_RPC = 'https://polygon-rpc.com';
