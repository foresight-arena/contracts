export type ContractSetName = 'fast' | 'production';

export interface ContractAddresses {
  roundManager: `0x${string}`;
  predictionArena: `0x${string}`;
  agentRegistry: `0x${string}`;
}

export const CONTRACT_SETS: Record<ContractSetName, ContractAddresses> = {
  fast: {
    roundManager: '0xa7BfBA3c20bB5c73A685eDb47b3454D3E3A5C58E',
    predictionArena: '0xDcEfA4c4cfF0609E43aB6CAbfeAA64ff47f33d92',
    agentRegistry: '0x8160cae7C06AD4aF0fC04944a6E61F566d68e736',
  },
  production: {
    roundManager: '0x0000000000000000000000000000000000000000',
    predictionArena: '0x0000000000000000000000000000000000000000',
    agentRegistry: '0x0000000000000000000000000000000000000000',
  },
};
