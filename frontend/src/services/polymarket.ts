export type MarketCategory = 'crypto' | 'sports' | 'politics' | 'science' | 'entertainment' | 'weather' | 'other';

export interface PolymarketInfo {
  conditionId: string;
  title: string;
  slug: string;
  url: string;
  endDate: string | null;
  closed: boolean;
  category: MarketCategory;
}

function detectCategory(slug: string, seriesSlug: string, question: string, hasGameId: boolean, tags: string[]): MarketCategory {
  // Sports events on Polymarket always have a gameId
  if (hasGameId) return 'sports';

  // Use Polymarket's own tags if available
  const tagStr = tags.join(' ').toLowerCase();
  if (/crypto|bitcoin|ethereum|defi|nft/.test(tagStr)) return 'crypto';
  if (/sport|football|soccer|basketball|tennis|baseball|hockey|racing|mma|boxing/.test(tagStr)) return 'sports';
  if (/politic|geopolitic|election|trump|congress|senate|democrat|republican/.test(tagStr)) return 'politics';
  if (/science|climate|space|nasa|ai\b/.test(tagStr)) return 'science';
  if (/weather|temperature/.test(tagStr)) return 'weather';
  if (/entertainment|movie|music|tv|oscar/.test(tagStr)) return 'entertainment';

  // Fallback to slug/question regex
  const s = `${slug} ${seriesSlug} ${question}`.toLowerCase();
  if (/bitcoin|btc|ethereum|eth|solana|sol|xrp|doge|crypto|defi|nft/.test(s)) return 'crypto';
  if (/ligue|premier.league|nba|nfl|mlb|nhl|serie|bundesliga|laliga|champions.league|uefa|fifa|f1|mma|ufc|boxing|tennis|soccer|football|basketball|baseball|hockey|sport|ncaa|tournament|championship|playoff|world.series|super.bowl|grand.prix|racing|cricket|rugby/.test(s)) return 'sports';
  if (/weather|temperature|rain|snow|wind|forecast|humidity|celsius|fahrenheit/.test(s)) return 'weather';
  if (/president|election|congress|senate|trump|biden|vote|political|democrat|republican|parliament/.test(s)) return 'politics';
  if (/science|climate|space|nasa|research|artificial.intelligence/.test(s)) return 'science';
  if (/oscar|grammy|movie|film|music|tv|show|celebrity|entertainment/.test(s)) return 'entertainment';
  return 'other';
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
    const event = m.events?.[0] || {};
    const eventSlug = event.slug || m.slug || '';
    const seriesSlug = event.seriesSlug || '';
    const hasGameId = !!event.gameId;
    // Extract tag slugs from event tags (array of objects with .slug)
    const eventTags = event.tags || [];
    const tags: string[] = Array.isArray(eventTags)
      ? eventTags.map((t: { slug?: string; label?: string }) => t.slug || t.label || '').filter(Boolean)
      : [];
    return {
      conditionId: m.conditionId || cid,
      title: m.question || m.title || cid,
      slug: eventSlug,
      url: eventSlug ? `https://polymarket.com/event/${eventSlug}` : '',
      endDate: m.endDateIso || m.end_date_iso || null,
      closed: m.closed || false,
      category: detectCategory(eventSlug, seriesSlug, m.question || '', hasGameId, tags),
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
