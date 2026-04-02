export type ContractSetName = 'fast' | 'production';

export interface ContractAddresses {
  roundManager: `0x${string}`;
  predictionArena: `0x${string}`;
  agentRegistry: `0x${string}`;
}

export const CONTRACT_SETS: Record<ContractSetName, ContractAddresses> = {
  fast: {
    roundManager: '0x625eD13a6c37DA525C96C3FBF65f35E266268Ee0',
    predictionArena: '0xF0C6EFD4A2F1B10528A360F388fbE45839c1b60f',
    agentRegistry: '0x624C60c4a3c7461909412FF9b7A0216d4cB0e637',
  },
  production: {
    roundManager: '0x0000000000000000000000000000000000000000',
    predictionArena: '0x0000000000000000000000000000000000000000',
    agentRegistry: '0x0000000000000000000000000000000000000000',
  },
};
