import type { PolymarketInfo } from '../services/polymarket';

const PREFIX = 'fa:market:';
const TTL_MS = 60 * 60 * 1000; // 1 hour

interface CachedEntry {
  v: 1;
  data: PolymarketInfo;
  cachedAt: number;
}

export function getCachedMarketMeta(conditionId: string): PolymarketInfo | null {
  try {
    const raw = localStorage.getItem(PREFIX + conditionId);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CachedEntry;
    if (entry.v !== 1) return null;
    if (Date.now() - entry.cachedAt > TTL_MS) {
      localStorage.removeItem(PREFIX + conditionId);
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
}

export function setCachedMarketMeta(conditionId: string, data: PolymarketInfo): void {
  try {
    const entry: CachedEntry = { v: 1, data, cachedAt: Date.now() };
    localStorage.setItem(PREFIX + conditionId, JSON.stringify(entry));
  } catch {
    // localStorage unavailable (private mode) or quota exceeded — ignore
  }
}

export function clearMarketMetaCache(): void {
  try {
    const keys = Object.keys(localStorage).filter(k => k.startsWith(PREFIX));
    for (const k of keys) localStorage.removeItem(k);
  } catch {}
}
