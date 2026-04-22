const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const CACHE_KEY_PREFIX = 'agent-meta:';

export interface AgentUriMeta {
  name?: string;
  url?: string;
  ts: number;
}

const memCache = new Map<string, Promise<AgentUriMeta> | AgentUriMeta>();

function loadLS(uri: string): AgentUriMeta | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY_PREFIX + uri);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AgentUriMeta;
    if (Date.now() - parsed.ts > CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveLS(uri: string, meta: AgentUriMeta): void {
  try {
    localStorage.setItem(CACHE_KEY_PREFIX + uri, JSON.stringify(meta));
  } catch {
    // localStorage full or unavailable — ignore
  }
}

export async function resolveAgentMetadata(agentURI: string): Promise<AgentUriMeta> {
  if (!agentURI) return { ts: Date.now() };

  const hit = memCache.get(agentURI);
  if (hit) return hit instanceof Promise ? hit : hit;

  const ls = loadLS(agentURI);
  if (ls) {
    memCache.set(agentURI, ls);
    return ls;
  }

  const promise = (async (): Promise<AgentUriMeta> => {
    try {
      const resp = await fetch(agentURI, { signal: AbortSignal.timeout(5000) });
      if (!resp.ok) {
        const empty = { ts: Date.now() };
        saveLS(agentURI, empty);
        memCache.set(agentURI, empty);
        return empty;
      }
      const data: any = await resp.json();
      const meta: AgentUriMeta = {
        name: typeof data?.name === 'string' ? data.name : undefined,
        url:
          typeof data?.url === 'string'
            ? data.url
            : typeof data?.external_url === 'string'
              ? data.external_url
              : undefined,
        ts: Date.now(),
      };
      saveLS(agentURI, meta);
      memCache.set(agentURI, meta);
      return meta;
    } catch {
      const empty = { ts: Date.now() };
      memCache.set(agentURI, empty);
      return empty;
    }
  })();

  memCache.set(agentURI, promise);
  return promise;
}
