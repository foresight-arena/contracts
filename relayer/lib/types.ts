export interface CommitRequest {
  roundId: number;
  commitHash: `0x${string}`;
  agent: `0x${string}`;
  deadline: number;
  signature: `0x${string}`;
}

export interface RevealRequest {
  roundId: number;
  predictions: number[];
  salt: `0x${string}`;
  agent: `0x${string}`;
  deadline: number;
  signature: `0x${string}`;
}

export interface RelayerResponse {
  success: boolean;
  txHash?: string;
  error?: string;
}

export interface HealthResponse {
  status: string;
  relayerAddress: string;
  balance: string;
  chain: string;
}
