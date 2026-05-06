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
        createdAtTimestamp
        benchmarksPosted
        invalidated
        outcomesTriggered
        outcomesTriggeredAt
        resolvedBitmask
        marketCount
        roundMarkets(orderBy: marketIndex) {
          market {
            id
            outcome
            resolvedAtTimestamp
          }
          marketIndex
          benchmarkPrice
        }
        agentRounds {
          agent {
            id
            agentURI
            owner
            registeredAt
          }
          commitHash
          commitTimestamp
          revealed
          revealTimestamp
          predictions
          brierScore
          alphaScore
          scoredMarkets
          totalMarkets
        }
      }
      agents(first: 1000, where: { registeredAt_gt: 0 }) {
        id
        agentId
        agentURI
        owner
        registeredAt
        registrationOrigin
        lastActiveTimestamp
      }
    }
  `);

  const rounds: Round[] = (data.rounds || []).map((r: any) => {
    // Build outcomes + resolution timestamps from roundMarkets
    const outcomes: (string | null)[] = [];
    const marketResolutions: { outcome: string | null; resolvedAt: number }[] = [];
    const sortedMarkets = [...(r.roundMarkets || [])].sort(
      (a: any, b: any) => a.marketIndex - b.marketIndex
    );
    for (const rm of sortedMarkets) {
      outcomes.push(rm.market?.outcome || null);
      marketResolutions.push({
        outcome: rm.market?.outcome || null,
        resolvedAt: Number(rm.market?.resolvedAtTimestamp || 0),
      });
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
        revealTimestamp: Number(ar.revealTimestamp || 0),
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
      marketResolutions,
      createdAt: Number(r.createdAtTimestamp || 0),
      commitDeadline: Number(r.commitDeadline),
      revealStart: Number(r.revealStart),
      revealDeadline: Number(r.revealDeadline),
      benchmarksPosted: r.benchmarksPosted,
      invalidated: r.invalidated,
      outcomesTriggered: r.outcomesTriggered ?? false,
      outcomesTriggeredAt: Number(r.outcomesTriggeredAt || 0),
      resolvedBitmask: Number(r.resolvedBitmask || 0),
      agents,
    } as Round;
  });

  const agentsMap = new Map<string, AgentInfo>();
  for (const a of data.agents || []) {
    const addr = a.id.toLowerCase();
    agentsMap.set(addr, {
      address: addr,
      agentId: a.agentId || null,
      agentURI: a.agentURI || '',
      name: '',
      url: '',
      owner: (a.owner || '').toLowerCase(),
      registeredAt: Number(a.registeredAt || 0),
      registrationOrigin: a.registrationOrigin === 'RELAYER' ? 'RELAYER' : 'DIRECT',
    });
  }

  return { rounds, agents: agentsMap };
}
