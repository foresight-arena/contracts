const SUBGRAPH = 'https://api.studio.thegraph.com/query/1745354/foresight-arena/version/latest';

async function querySubgraph(query: string): Promise<any> {
  const resp = await fetch(SUBGRAPH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const json = await resp.json();
  return json.data;
}

interface AgentSubgraphData {
  agentId: string;
  agent: string;
  name: string;
  url: string;
  model: string;
  owner: string;
  totalScore: string;
  roundsPlayed: string;
  averageScore: string;
}

/**
 * Assemble OpenSea-compatible JSON metadata for an agent NFT.
 */
export async function getAgentMetadata(agentId: string): Promise<object | null> {
  const data = await querySubgraph(`{
    agentToken(id: "${agentId}") {
      agentId
      agent
      name
      url
      model
      owner
      totalScore
      roundsPlayed
      averageScore
    }
  }`);

  const agent: AgentSubgraphData | null = data?.agentToken || null;
  if (!agent) return null;

  const roundsPlayed = Number(agent.roundsPlayed || '0');
  const averageScore = Number(agent.averageScore || '0');
  const totalScore = Number(agent.totalScore || '0');

  return {
    name: agent.name || `Agent #${agentId}`,
    description: `Foresight Arena prediction agent${agent.model ? ` powered by ${agent.model}` : ''}. ${roundsPlayed} rounds played.`,
    image: `RELAYER_BASE_URL/agent/${agentId}/image`,
    external_url: agent.url || undefined,
    attributes: [
      { trait_type: 'Model', value: agent.model || 'Unknown' },
      { trait_type: 'Rounds Played', display_type: 'number', value: roundsPlayed },
      { trait_type: 'Total Score', display_type: 'number', value: totalScore },
      { trait_type: 'Average Score', display_type: 'number', value: averageScore },
      { trait_type: 'Agent Address', value: agent.agent },
      { trait_type: 'Owner', value: agent.owner },
    ],
  };
}

/**
 * Generate a dynamic SVG card with agent stats.
 */
export async function getAgentImage(agentId: string): Promise<string | null> {
  const data = await querySubgraph(`{
    agentToken(id: "${agentId}") {
      agentId
      agent
      name
      model
      totalScore
      roundsPlayed
      averageScore
    }
  }`);

  const agent: AgentSubgraphData | null = data?.agentToken || null;
  if (!agent) return null;

  const name = escapeXml(agent.name || `Agent #${agentId}`);
  const model = escapeXml(agent.model || 'Unknown');
  const roundsPlayed = agent.roundsPlayed || '0';
  const avgScore = Number(agent.averageScore || '0').toFixed(1);
  const totalScore = agent.totalScore || '0';
  const shortAddr = `${agent.agent.slice(0, 6)}...${agent.agent.slice(-4)}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="250" viewBox="0 0 400 250">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#1a1a2e;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#16213e;stop-opacity:1" />
    </linearGradient>
  </defs>
  <rect width="400" height="250" rx="16" fill="url(#bg)" />
  <rect x="1" y="1" width="398" height="248" rx="15" fill="none" stroke="#0f3460" stroke-width="2" />
  <text x="24" y="40" font-family="monospace" font-size="18" font-weight="bold" fill="#e94560">${name}</text>
  <text x="24" y="62" font-family="monospace" font-size="11" fill="#888">${shortAddr}</text>
  <text x="24" y="84" font-family="monospace" font-size="12" fill="#aaa">Model: ${model}</text>
  <line x1="24" y1="100" x2="376" y2="100" stroke="#0f3460" stroke-width="1" />
  <text x="24" y="130" font-family="monospace" font-size="13" fill="#ccc">Rounds Played</text>
  <text x="376" y="130" font-family="monospace" font-size="13" fill="#e94560" text-anchor="end">${roundsPlayed}</text>
  <text x="24" y="158" font-family="monospace" font-size="13" fill="#ccc">Total Score</text>
  <text x="376" y="158" font-family="monospace" font-size="13" fill="#e94560" text-anchor="end">${totalScore}</text>
  <text x="24" y="186" font-family="monospace" font-size="13" fill="#ccc">Avg Score</text>
  <text x="376" y="186" font-family="monospace" font-size="13" fill="#e94560" text-anchor="end">${avgScore}</text>
  <text x="200" y="230" font-family="monospace" font-size="10" fill="#555" text-anchor="middle">Foresight Arena</text>
</svg>`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
