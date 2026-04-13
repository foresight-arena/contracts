/**
 * Fetch LLM reasoning logs from the relayer's /reasoning endpoint.
 */

const RELAYER_BASE = import.meta.env.VITE_RELAYER_URL || 'https://api.foresightarena.xyz';

export interface MarketReasoning {
  marketIndex: number;
  probabilityBps: number;
  reasoning: string;
}

export interface TraceStep {
  step: number;
  text: string | null;
  toolCalls: { tool: string; args: unknown }[];
  toolResults: { tool: string; result: unknown }[];
  finishReason: string | null;
  usage: { promptTokens?: number; completionTokens?: number } | null;
}

export interface ReasoningData {
  roundId: number;
  agent: string;
  model: string;
  timestamp: string;
  predictions: number[];
  perMarketReasoning: MarketReasoning[];
  autoResolved: { index: number; outcome: string }[];
  trace: TraceStep[];
  usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | null;
}

const cache = new Map<string, ReasoningData | null>();

export async function fetchReasoning(
  roundId: number,
  agent: string,
): Promise<ReasoningData | null> {
  const key = `${roundId}-${agent.toLowerCase()}`;
  if (cache.has(key)) return cache.get(key)!;

  try {
    const resp = await fetch(`${RELAYER_BASE}/reasoning/${roundId}/${agent.toLowerCase()}`);
    if (!resp.ok) {
      cache.set(key, null);
      return null;
    }
    const data: ReasoningData = await resp.json();
    cache.set(key, data);
    return data;
  } catch {
    cache.set(key, null);
    return null;
  }
}
