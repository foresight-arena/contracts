const SUBGRAPH = 'https://api.studio.thegraph.com/query/1745354/foresight-arena/version/latest';
const RELAYER_BASE = process.env.RELAYER_BASE_URL || 'https://api.foresightarena.xyz';
const PLATFORM_URL = 'https://foresightarena.xyz';

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
  address: string;
  name: string;
  url: string;
  model: string;
  totalBrierScore: string;
  totalAlphaScore: string;
  scoredRoundCount: number;
}

/**
 * Assemble OpenSea-compatible JSON metadata for an agent NFT.
 */
export async function getAgentMetadata(agentId: string): Promise<object | null> {
  const data = await querySubgraph(`{
    agents(where: { agentId: "${agentId}" }, first: 1) {
      agentId
      address
      name
      url
      model
      totalBrierScore
      totalAlphaScore
      scoredRoundCount
    }
  }`);

  const agents = data?.agents || [];
  const agent = agents.length > 0 ? agents[0] : null;
  if (!agent) return null;

  const roundsPlayed = Number(agent.scoredRoundCount || 0);
  const totalBrier = Number(agent.totalBrierScore || 0);
  const totalAlpha = Number(agent.totalAlphaScore || 0);
  const avgBrier = roundsPlayed > 0 ? ((totalBrier / roundsPlayed) / 1e8 * 100).toFixed(2) : '0';
  const avgAlpha = roundsPlayed > 0 ? ((totalAlpha / roundsPlayed) / 1e8 * 100).toFixed(2) : '0';

  return {
    name: `${agent.name || `Agent #${agentId}`} — Foresight Arena`,
    description: `AI prediction agent competing in Foresight Arena (foresightarena.xyz), an on-chain prediction competition on Polygon.${agent.model ? ` Powered by ${agent.model}.` : ''} ${roundsPlayed} rounds played.`,
    image: `${RELAYER_BASE}/agent/${agentId}/image`,
    external_url: `${PLATFORM_URL}/agent/${agentId}`,
    attributes: [
      { trait_type: 'Platform', value: 'Foresight Arena' },
      { trait_type: 'Chain', value: 'Polygon' },
      { trait_type: 'Model', value: agent.model || 'Unknown' },
      { trait_type: 'Rounds Played', display_type: 'number', value: roundsPlayed },
      { trait_type: 'Avg Brier Score', value: `${avgBrier}%` },
      { trait_type: 'Avg Alpha Score', value: `${avgAlpha}%` },
      { trait_type: 'Agent Address', value: agent.address },
    ],
    ...(agent.url ? { agent_url: agent.url } : {}),
  };
}

/**
 * Generate a dynamic SVG card with agent stats.
 */
export async function getAgentImage(agentId: string): Promise<string | null> {
  const data = await querySubgraph(`{
    agents(where: { agentId: "${agentId}" }, first: 1) {
      agentId
      address
      name
      model
      totalBrierScore
      totalAlphaScore
      scoredRoundCount
    }
  }`);

  const agents = data?.agents || [];
  const agent = agents.length > 0 ? agents[0] : null;
  if (!agent) return null;

  const name = escapeXml(agent.name || `Agent #${agentId}`);
  const model = escapeXml(agent.model || 'Unknown');
  const rounds = Number(agent.scoredRoundCount || 0);
  const totalAlpha = Number(agent.totalAlphaScore || 0);
  const avgAlpha = rounds > 0 ? ((totalAlpha / rounds) / 1e8 * 100).toFixed(1) : '0.0';
  const addr = agent.address || '';
  const shortAddr = addr.length >= 10 ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : addr;

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
  <text x="376" y="130" font-family="monospace" font-size="13" fill="#e94560" text-anchor="end">${rounds}</text>
  <text x="24" y="158" font-family="monospace" font-size="13" fill="#ccc">Avg Alpha</text>
  <text x="376" y="158" font-family="monospace" font-size="13" fill="#e94560" text-anchor="end">${avgAlpha}%</text>
  <text x="200" y="228" font-family="monospace" font-size="10" fill="#555" text-anchor="middle">foresightarena.xyz</text>
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
