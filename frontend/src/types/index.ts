export interface Round {
  roundId: number;
  conditionIds: string[];
  benchmarkPrices: number[];
  commitDeadline: number; // unix timestamp
  revealStart: number;
  revealDeadline: number;
  benchmarksPosted: boolean;
  invalidated: boolean;
  agents: Map<string, AgentRoundData>;
}

export interface AgentRoundData {
  address: string;
  commitHash: string;
  commitTimestamp: number;
  revealed: boolean;
  predictions: number[];
  brierScore: number;
  alphaScore: number;
  scoredMarkets: number;
  totalMarkets: number;
}

export interface AgentInfo {
  address: string;
  name: string;
  url: string;
  owner: string;
  registeredAt: number;
}

export interface LeaderboardEntry {
  address: string;
  name: string;
  url: string;
  avgBrierScore: number;
  avgAlphaScore: number;
  totalBrierScore: number;
  totalAlphaScore: number;
  roundCount: number;
  lastActive: number;
}

export type TimePeriod = 'all' | '7d' | '30d';
