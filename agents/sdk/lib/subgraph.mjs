const DEFAULT_URL = 'https://api.studio.thegraph.com/query/1745354/foresight-arena/version/latest';
const SUBGRAPH_URL = process.env.SUBGRAPH_URL || DEFAULT_URL;

export async function querySubgraph(query) {
  const resp = await fetch(SUBGRAPH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!resp.ok) throw new Error(`Subgraph query failed: ${resp.status}`);
  const json = await resp.json();
  if (json.errors) throw new Error(`Subgraph error: ${json.errors[0].message}`);
  return json.data;
}

export async function getActiveRounds() {
  const now = Math.floor(Date.now() / 1000);
  const data = await querySubgraph(`{
    rounds(orderBy: roundId, orderDirection: desc, first: 20) {
      roundId conditionIds commitDeadline revealStart revealDeadline
      benchmarksPosted invalidated outcomesTriggered marketCount
    }
  }`);
  return (data.rounds || []).filter(
    (r) => Number(r.commitDeadline) > now && !r.invalidated,
  );
}

export async function getRound(roundId) {
  const data = await querySubgraph(`{
    round(id: "${roundId}") {
      roundId conditionIds commitDeadline revealStart revealDeadline
      benchmarksPosted invalidated outcomesTriggered marketCount
    }
  }`);
  return data.round || null;
}

export async function getNonce(address) {
  const data = await querySubgraph(`{
    agent(id: "${address.toLowerCase()}") { gaslessNonce }
  }`);
  return BigInt(data.agent?.gaslessNonce ?? 0);
}

export async function getScore(roundId, address) {
  const data = await querySubgraph(`{
    agentRound(id: "${roundId}-${address.toLowerCase()}") {
      brierScore alphaScore scoredMarkets totalMarkets revealed
    }
  }`);
  return data.agentRound || null;
}

export async function getAllScores(address) {
  const data = await querySubgraph(`{
    agentRounds(where: { agent: "${address.toLowerCase()}", scoredMarkets_gt: 0 }, orderBy: round__roundId, orderDirection: desc, first: 50) {
      round { roundId }
      brierScore alphaScore scoredMarkets totalMarkets
    }
  }`);
  return data.agentRounds || [];
}

export async function isRegistered(address) {
  const data = await querySubgraph(`{
    agent(id: "${address.toLowerCase()}") { agentId }
  }`);
  return data.agent?.agentId != null;
}
