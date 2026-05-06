const SUBGRAPH = process.env.SUBGRAPH_URL || 'https://api.studio.thegraph.com/query/1745354/foresight-arena/version/latest';
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
  agentURI?: string;
  name?: string;
  url?: string;
  totalBrierScore: string;
  totalAlphaScore: string;
  scoredRoundCount: number;
}

// Fetch optional off-chain metadata from an agent's ERC-8004 agentURI.
// Best-effort — any failure just returns empty fields.
async function fetchAgentUriMetadata(agentURI: string | undefined): Promise<{ name?: string; url?: string }> {
  if (!agentURI) return {};
  try {
    const resp = await fetch(agentURI, { signal: AbortSignal.timeout(3000) });
    if (!resp.ok) return {};
    const data: any = await resp.json();
    return {
      name: typeof data.name === 'string' ? data.name : undefined,
      url: typeof data.url === 'string' ? data.url : (typeof data.external_url === 'string' ? data.external_url : undefined),
    };
  } catch {
    return {};
  }
}

/**
 * Assemble OpenSea-compatible JSON metadata for an agent, looked up by address.
 */
export async function getAgentMetadata(address: string): Promise<object | null> {
  const addr = address.toLowerCase();
  const data = await querySubgraph(`{
    agent(id: "${addr}") {
      agentId
      address
      agentURI
      totalBrierScore
      totalAlphaScore
      scoredRoundCount
    }
  }`);

  const agent: AgentSubgraphData | null = data?.agent || null;
  if (!agent) return null;

  const roundsPlayed = Number(agent.scoredRoundCount || 0);
  const totalBrier = Number(agent.totalBrierScore || 0);
  const totalAlpha = Number(agent.totalAlphaScore || 0);
  const avgBrier = roundsPlayed > 0 ? ((totalBrier / roundsPlayed) / 1e8 * 100).toFixed(2) : '0';
  const avgAlpha = roundsPlayed > 0 ? ((totalAlpha / roundsPlayed) / 1e8 * 100).toFixed(2) : '0';

  const offchain = await fetchAgentUriMetadata(agent.agentURI);
  const displayName = offchain.name || `Agent ${addr.slice(0, 6)}...${addr.slice(-4)}`;
  const agentUrl = offchain.url;

  return {
    name: `${displayName} — Foresight Arena`,
    description: `AI prediction agent competing in Foresight Arena (foresightarena.xyz), an on-chain prediction competition on Polygon. ${roundsPlayed} rounds played.`,
    image: `${RELAYER_BASE}/agent/${addr}/image`,
    external_url: `${PLATFORM_URL}/agent/${addr}`,
    attributes: [
      { trait_type: 'Platform', value: 'Foresight Arena' },
      { trait_type: 'Chain', value: 'Polygon' },
      { trait_type: 'Rounds Played', display_type: 'number', value: roundsPlayed },
      { trait_type: 'Avg Brier Score', value: `${avgBrier}%` },
      { trait_type: 'Avg Alpha Score', value: `${avgAlpha}%` },
      { trait_type: 'Agent Address', value: addr },
    ],
    ...(agentUrl ? { agent_url: agentUrl } : {}),
  };
}

/**
 * Generate a dynamic SVG card with agent stats, looked up by address.
 */
export async function getAgentImage(address: string): Promise<string | null> {
  const addr = address.toLowerCase();
  const data = await querySubgraph(`{
    agent(id: "${addr}") {
      agentId
      address
      agentURI
      totalBrierScore
      totalAlphaScore
      scoredRoundCount
    }
  }`);

  const agent: AgentSubgraphData | null = data?.agent || null;
  if (!agent) return null;

  const offchain = await fetchAgentUriMetadata(agent.agentURI);
  const name = escapeXml(offchain.name || `Agent ${addr.slice(0, 6)}...${addr.slice(-4)}`);
  const rounds = Number(agent.scoredRoundCount || 0);
  const totalAlpha = Number(agent.totalAlphaScore || 0);
  const avgAlpha = rounds > 0 ? ((totalAlpha / rounds) / 1e8 * 100).toFixed(1) : '0.0';
  const shortAddr = addr.length >= 10 ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : addr;

  const totalBrier = Number(agent.totalBrierScore || 0);
  const avgBrier = rounds > 0 ? ((totalBrier / rounds) / 1e8 * 100).toFixed(1) : '0.0';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#1a1a2e;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#16213e;stop-opacity:1" />
    </linearGradient>
  </defs>
  <rect width="400" height="400" rx="20" fill="url(#bg)" />
  <rect x="1" y="1" width="398" height="398" rx="19" fill="none" stroke="#0f3460" stroke-width="2" />
  <text x="32" y="52" font-family="monospace" font-size="22" font-weight="bold" fill="#e94560">${name}</text>
  <text x="32" y="80" font-family="monospace" font-size="14" fill="#888">${shortAddr}</text>
  <line x1="32" y1="110" x2="368" y2="110" stroke="#0f3460" stroke-width="1" />
  <text x="32" y="155" font-family="monospace" font-size="16" fill="#ccc">Rounds Played</text>
  <text x="368" y="155" font-family="monospace" font-size="20" fill="#e94560" text-anchor="end">${rounds}</text>
  <text x="32" y="200" font-family="monospace" font-size="16" fill="#ccc">Avg Brier</text>
  <text x="368" y="200" font-family="monospace" font-size="20" fill="#e94560" text-anchor="end">${avgBrier}%</text>
  <text x="32" y="245" font-family="monospace" font-size="16" fill="#ccc">Avg Alpha</text>
  <text x="368" y="245" font-family="monospace" font-size="20" fill="#e94560" text-anchor="end">${avgAlpha}%</text>
  <text x="200" y="370" font-family="monospace" font-size="13" fill="#555" text-anchor="middle">foresightarena.xyz</text>
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
