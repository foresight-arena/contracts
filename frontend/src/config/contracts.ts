export interface ContractAddresses {
  roundManager: `0x${string}`;
  predictionArena: `0x${string}`;
  agentNFT: `0x${string}`;
}

export const CONTRACTS: ContractAddresses = {
  roundManager: '0x625eD13a6c37DA525C96C3FBF65f35E266268Ee0',
  predictionArena: '0xF0C6EFD4A2F1B10528A360F388fbE45839c1b60f',
  agentNFT: '0x0000000000000000000000000000000000000000', // updated after deploy
};
