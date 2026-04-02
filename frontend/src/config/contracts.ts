export type ContractSetName = 'fast' | 'production';

export interface ContractAddresses {
  roundManager: `0x${string}`;
  predictionArena: `0x${string}`;
  agentRegistry: `0x${string}`;
}

export const CONTRACT_SETS: Record<ContractSetName, ContractAddresses> = {
  fast: {
    roundManager: '0x1B27B5A3612F3ed7f12a674257aC3F067D08b481',
    predictionArena: '0x9B8401db62bA6e95a57db38F383e6599C18041e7',
    agentRegistry: '0xcD721cfB8bc8594bA364fF17490A4B2c4e17D6EB',
  },
  production: {
    roundManager: '0x0000000000000000000000000000000000000000',
    predictionArena: '0x0000000000000000000000000000000000000000',
    agentRegistry: '0x0000000000000000000000000000000000000000',
  },
};
