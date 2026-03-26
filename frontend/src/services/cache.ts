const CACHE_VERSION = 1;

interface CacheEntry {
  version: number;
  lastBlock: number;
  rounds: any; // serialized Round data
  agents: any; // serialized AgentInfo data
  timestamp: number;
}

function getCacheKey(contractSet: string): string {
  return `fsa_cache_${contractSet}_v${CACHE_VERSION}`;
}

export function getCached(contractSet: string): CacheEntry | null {
  try {
    const raw = localStorage.getItem(getCacheKey(contractSet));
    if (!raw) return null;
    const entry: CacheEntry = JSON.parse(raw);
    if (entry.version !== CACHE_VERSION) return null;
    return entry;
  } catch {
    return null;
  }
}

export function setCache(contractSet: string, lastBlock: number, rounds: any, agents: any): void {
  const entry: CacheEntry = {
    version: CACHE_VERSION,
    lastBlock,
    rounds,
    agents,
    timestamp: Date.now(),
  };
  localStorage.setItem(getCacheKey(contractSet), JSON.stringify(entry));
}
