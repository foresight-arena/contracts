import type { Round, AgentRoundData, AgentInfo } from '../types';

const SUBGRAPH_URL = import.meta.env.VITE_SUBGRAPH_URL || '';

async function query(gql: string, variables?: Record<string, unknown>): Promise<any> {
  if (!SUBGRAPH_URL) throw new Error('VITE_SUBGRAPH_URL not set');
  const resp = await fetch(SUBGRAPH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: gql, variables }),
  });
  if (!resp.ok) throw new Error(`Subgraph query failed: ${resp.status}`);
  const json = await resp.json();
  if (json.errors) throw new Error(json.errors[0].message);
  return json.data;
}

export async function fetchAllData(): Promise<{
  rounds: Round[];
  agents: Map<string, AgentInfo>;
}> {
  const data = await query(`
    {
      rounds(orderBy: roundId, orderDirection: desc, first: 1000) {
        roundId
        conditionIds
        benchmarkPrices
        commitDeadline
        revealStart
        revealDeadline
        benchmarksPosted
        invalidated
        marketCount
        roundMarkets(orderBy: marketIndex) {
          market {
            id
            outcome
          }
          marketIndex
          benchmarkPrice
        }
        agentRounds {
          agent {
            id
            name
            url
            owner
            registeredAt
          }
          commitHash
          commitTimestamp
          revealed
          predictions
          brierScore
          alphaScore
          scoredMarkets
          totalMarkets
        }
      }
      agents(first: 1000) {
        id
        name
        url
        owner
        registeredAt
      }
    }
  `);

  const rounds: Round[] = (data.rounds || []).map((r: any) => {
    // Build outcomes array from roundMarkets
    const outcomes: (string | null)[] = [];
    const sortedMarkets = [...(r.roundMarkets || [])].sort(
      (a: any, b: any) => a.marketIndex - b.marketIndex
    );
    for (const rm of sortedMarkets) {
      outcomes.push(rm.market?.outcome || null);
    }

    // Build agents map
    const agents = new Map<string, AgentRoundData>();
    for (const ar of r.agentRounds || []) {
      const addr = ar.agent.id.toLowerCase();
      agents.set(addr, {
        address: addr,
        commitHash: ar.commitHash,
        commitTimestamp: Number(ar.commitTimestamp),
        revealed: ar.revealed,
        predictions: (ar.predictions || []).map(Number),
        brierScore: Number(ar.brierScore),
        alphaScore: Number(ar.alphaScore),
        scoredMarkets: ar.scoredMarkets,
        totalMarkets: ar.totalMarkets,
      });
    }

    return {
      roundId: Number(r.roundId),
      conditionIds: r.conditionIds,
      benchmarkPrices: r.benchmarkPrices.map(Number),
      outcomes,
      commitDeadline: Number(r.commitDeadline),
      revealStart: Number(r.revealStart),
      revealDeadline: Number(r.revealDeadline),
      benchmarksPosted: r.benchmarksPosted,
      invalidated: r.invalidated,
      agents,
    } as Round;
  });

  const agentsMap = new Map<string, AgentInfo>();
  for (const a of data.agents || []) {
    const addr = a.id.toLowerCase();
    agentsMap.set(addr, {
      address: addr,
      name: a.name || '',
      url: a.url || '',
      owner: (a.owner || '').toLowerCase(),
      registeredAt: Number(a.registeredAt || 0),
    });
  }

  return { rounds, agents: agentsMap };
}
