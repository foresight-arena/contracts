export interface PolymarketInfo {
  conditionId: string;
  title: string;
  slug: string;
  url: string;
}

const cache = new Map<string, PolymarketInfo>();

async function fetchOne(cid: string): Promise<PolymarketInfo | null> {
  try {
    const resp = await fetch(`/api/polymarket/markets?condition_ids=${cid}`);
    if (!resp.ok) return null;
    const markets = await resp.json();
    if (!Array.isArray(markets) || markets.length === 0) return null;
    const m = markets[0];
    const slug = m.slug || '';
    return {
      conditionId: m.conditionId || cid,
      title: m.question || m.title || slug || cid,
      slug,
      url: slug ? `https://polymarket.com/event/${slug}` : '',
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

  // Fetch individually (gamma API doesn't support comma-separated IDs)
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
