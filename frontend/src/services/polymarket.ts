export interface PolymarketInfo {
  conditionId: string;
  title: string;
  slug: string;
  url: string;
  endDate: string | null; // ISO timestamp when market resolves
  closed: boolean;
}

const cache = new Map<string, PolymarketInfo>();

// In dev, Vite proxy handles /api/polymarket → gamma-api.polymarket.com
// In production, use the relayer Lambda as a CORS proxy
const POLYMARKET_BASE = import.meta.env.DEV
  ? '/api/polymarket'
  : (import.meta.env.VITE_RELAYER_URL || 'https://api.foresightarena.xyz') + '/polymarket';

async function fetchOne(cid: string): Promise<PolymarketInfo | null> {
  try {
    const resp = await fetch(`${POLYMARKET_BASE}/markets?condition_ids=${cid}`);
    if (!resp.ok) return null;
    const markets = await resp.json();
    if (!Array.isArray(markets) || markets.length === 0) return null;
    const m = markets[0];
    const eventSlug = m.events?.[0]?.slug || m.slug || '';
    return {
      conditionId: m.conditionId || cid,
      title: m.question || m.title || cid,
      slug: eventSlug,
      url: eventSlug ? `https://polymarket.com/event/${eventSlug}` : '',
      endDate: m.endDateIso || m.end_date_iso || null,
      closed: m.closed || false,
    };
  } catch {
    return null;
  }
}

export async function fetchMarketMetadata(
  conditionIds: string[],
): Promise<Map<string, PolymarketInfo>> {
  const result = new Map<string, PolymarketInfo>();
  const toFetch: string[] = [];

  for (const cid of conditionIds) {
    const cached = cache.get(cid);
    if (cached) {
      result.set(cid, cached);
    } else {
      toFetch.push(cid);
    }
  }

  const fetches = toFetch.map(async (cid) => {
    const info = await fetchOne(cid);
    if (info) {
      cache.set(cid, info);
      result.set(cid, info);
    }
  });

  await Promise.all(fetches);
  return result;
}
