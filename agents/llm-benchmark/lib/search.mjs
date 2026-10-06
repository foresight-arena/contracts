/**
 * Web search backends for the `searchWeb` tool.
 *
 * Every backend is an async `search(query)` returning
 *   { answer: string|null, results: [{ title, url, snippet, publishedDate? }] }
 * so the tool the model sees is identical regardless of backend.
 */

import { createAgentCoreWebSearch } from './agentcore.mjs';

export const SEARCH_PROVIDERS = ['tavily', 'agentcore', 'none'];

const RESULTS_PER_QUERY = 5;
// Over-fetch so the model still gets RESULTS_PER_QUERY after exclusions
const EXCLUSION_HEADROOM = 3;
// Polymarket's own market pages mostly echo the price the model already has
const DEFAULT_EXCLUDE_DOMAINS = 'polymarket.com';

function parseDomains(value) {
  return (value ?? DEFAULT_EXCLUDE_DOMAINS)
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Drop results hosted exactly on an excluded domain (or its `www.`). Other
 * subdomains are kept on purpose: e.g. xtracker.polymarket.com is the resolution
 * source for Truth Social post-count markets. (AgentCore's own domain filter
 * would also match subdomains, hence filtering here.)
 */
function withDomainExclusion(search, domains, maxResults) {
  if (domains.length === 0) return search;
  const excluded = new Set(domains.flatMap((d) => [d, `www.${d}`]));
  const isExcluded = (url) => {
    try { return excluded.has(new URL(url).hostname.toLowerCase()); } catch { return false; }
  };
  const filtered = async (query) => {
    const out = await search(query);
    return { ...out, results: out.results.filter((r) => !r.url || !isExcluded(r.url)).slice(0, maxResults) };
  };
  if (search.preflight) filtered.preflight = search.preflight;
  return filtered;
}

function createTavilySearch({ apiKey, maxResults = 5 }) {
  return async function search(query) {
    const resp = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: maxResults,
        search_depth: 'basic',
        include_answer: true,
      }),
    });

    if (!resp.ok) throw new Error(`Tavily API error: ${resp.status}`);

    const data = await resp.json();
    return {
      answer: data.answer || null,
      results: (data.results || []).map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.content,
      })),
    };
  };
}

/**
 * Pick the search backend. Explicit SEARCH_PROVIDER wins; otherwise AgentCore if
 * a gateway URL is configured, then Tavily if a key is set, else disabled.
 */
export function resolveSearchProvider(env) {
  const explicit = env.SEARCH_PROVIDER?.toLowerCase();
  if (explicit) {
    if (!SEARCH_PROVIDERS.includes(explicit)) {
      throw new Error(`Invalid SEARCH_PROVIDER: ${explicit} (must be ${SEARCH_PROVIDERS.join('|')})`);
    }
    return explicit;
  }
  if (env.AGENTCORE_GATEWAY_URL) return 'agentcore';
  if (env.TAVILY_API_KEY) return 'tavily';
  return 'none';
}

/**
 * Returns a `search(query)` function, or null when web search is disabled.
 * SEARCH_EXCLUDE_DOMAINS (comma-separated, default `polymarket.com`; empty
 * string disables) applies to every backend so they stay comparable.
 */
export function createWebSearch(provider, env) {
  const domains = parseDomains(env.SEARCH_EXCLUDE_DOMAINS);
  const headroom = domains.length ? EXCLUSION_HEADROOM : 0;

  switch (provider) {
    case 'tavily': {
      if (!env.TAVILY_API_KEY) throw new Error('SEARCH_PROVIDER=tavily requires TAVILY_API_KEY');
      const search = createTavilySearch({ apiKey: env.TAVILY_API_KEY, maxResults: RESULTS_PER_QUERY + headroom });
      return withDomainExclusion(search, domains, RESULTS_PER_QUERY);
    }
    case 'agentcore': {
      if (!env.AGENTCORE_GATEWAY_URL) throw new Error('SEARCH_PROVIDER=agentcore requires AGENTCORE_GATEWAY_URL');
      const maxResults = Number(env.AGENTCORE_MAX_RESULTS || RESULTS_PER_QUERY);
      const search = createAgentCoreWebSearch({
        gatewayUrl: env.AGENTCORE_GATEWAY_URL,
        region: env.AGENTCORE_REGION,
        bearerToken: env.AGENTCORE_GATEWAY_TOKEN,
        toolName: env.AGENTCORE_SEARCH_TOOL,
        maxResults: Math.min(25, maxResults + headroom),
      });
      return withDomainExclusion(search, domains, maxResults);
    }
    default:
      return null;
  }
}
