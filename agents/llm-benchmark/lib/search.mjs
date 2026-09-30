/**
 * Web search backends for the `searchWeb` tool.
 *
 * Every backend is an async `search(query)` returning
 *   { answer: string|null, results: [{ title, url, snippet, publishedDate? }] }
 * so the tool the model sees is identical regardless of backend.
 */

import { createAgentCoreWebSearch } from './agentcore.mjs';

export const SEARCH_PROVIDERS = ['tavily', 'agentcore', 'none'];

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

/** Returns a `search(query)` function, or null when web search is disabled. */
export function createWebSearch(provider, env) {
  switch (provider) {
    case 'tavily':
      if (!env.TAVILY_API_KEY) throw new Error('SEARCH_PROVIDER=tavily requires TAVILY_API_KEY');
      return createTavilySearch({ apiKey: env.TAVILY_API_KEY });
    case 'agentcore':
      if (!env.AGENTCORE_GATEWAY_URL) throw new Error('SEARCH_PROVIDER=agentcore requires AGENTCORE_GATEWAY_URL');
      return createAgentCoreWebSearch({
        gatewayUrl: env.AGENTCORE_GATEWAY_URL,
        region: env.AGENTCORE_REGION,
        bearerToken: env.AGENTCORE_GATEWAY_TOKEN,
        toolName: env.AGENTCORE_SEARCH_TOOL,
        maxResults: Number(env.AGENTCORE_MAX_RESULTS || 5),
      });
    default:
      return null;
  }
}
