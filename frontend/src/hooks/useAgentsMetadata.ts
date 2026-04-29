import { useEffect, useState } from 'react';
import { resolveAgentMetadata } from '../services/agentMetadata';
import type { AgentInfo } from '../types';

export type ResolvedAgentsMeta = Map<string, { name?: string; url?: string; image?: string }>;

/**
 * Resolves off-chain metadata (JSON at agentURI) for a set of agents.
 * Returns a Map keyed by lowercase address. Re-renders as fetches complete.
 */
export function useAgentsMetadata(agents: Map<string, AgentInfo>): ResolvedAgentsMeta {
  const [resolved, setResolved] = useState<ResolvedAgentsMeta>(new Map());

  useEffect(() => {
    const toFetch: { addr: string; uri: string }[] = [];
    for (const [addr, info] of agents) {
      if (info.agentURI) toFetch.push({ addr: addr.toLowerCase(), uri: info.agentURI });
    }
    if (toFetch.length === 0) return;

    let cancelled = false;
    (async () => {
      const results = await Promise.all(
        toFetch.map(async ({ addr, uri }) => ({ addr, meta: await resolveAgentMetadata(uri) })),
      );
      if (cancelled) return;
      setResolved((prev) => {
        const next = new Map(prev);
        for (const { addr, meta } of results) {
          if (meta.name || meta.url || meta.image) next.set(addr, { name: meta.name, url: meta.url, image: meta.image });
        }
        return next;
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [agents]);

  return resolved;
}
