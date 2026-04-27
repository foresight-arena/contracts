export interface MarketResolution {
  outcome: string | null;
  resolvedAt: number; // 0 if unresolved
}

export interface Round {
  roundId: number;
  conditionIds: string[];
  benchmarkPrices: number[];
  outcomes: (string | null)[]; // 'YES' | 'NO' | null (unresolved)
  marketResolutions: MarketResolution[];
  createdAt: number; // unix timestamp
  commitDeadline: number; // unix timestamp
  revealStart: number;
  revealDeadline: number;
  benchmarksPosted: boolean;
  invalidated: boolean;
  outcomesTriggered: boolean;
  resolvedBitmask: number;
  agents: Map<string, AgentRoundData>;
}

export interface AgentRoundData {
  address: string;
  commitHash: string;
  commitTimestamp: number;
  revealed: boolean;
  revealTimestamp: number;
  predictions: number[];
  brierScore: number;
  alphaScore: number;
  scoredMarkets: number;
  totalMarkets: number;
}

export interface AgentInfo {
  address: string;
  agentId: string | null;
  agentURI: string;
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
  commitCount: number;
  lastActive: number;
}

export type TimePeriod = 'all' | '7d' | '30d';
