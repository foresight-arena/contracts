/**
 * Polymarket gamma + CLOB API client.
 * Handles closed=true fallback for resolved markets.
 */

const GAMMA = 'https://gamma-api.polymarket.com';
const CLOB = 'https://clob.polymarket.com';

export async function getMarket(conditionId) {
  let resp = await fetch(`${GAMMA}/markets?condition_ids=${conditionId}`);
  if (!resp.ok) return null;
  let markets = await resp.json();

  if (!Array.isArray(markets) || markets.length === 0) {
    // Fall back to closed markets
    resp = await fetch(`${GAMMA}/markets?condition_ids=${conditionId}&closed=true`);
    if (!resp.ok) return null;
    markets = await resp.json();
    if (!Array.isArray(markets) || markets.length === 0) return null;
  }

  return markets[0];
}

export async function getMarkets(conditionIds) {
  return Promise.all(conditionIds.map((cid) => getMarket(cid)));
}

export async function getPriceHistory(tokenId, fidelity = 60) {
  // CLOB prices-history endpoint. interval=1d returns last day; we use a longer range
  const url = `${CLOB}/prices-history?market=${tokenId}&interval=1w&fidelity=${fidelity}`;
  const resp = await fetch(url);
  if (!resp.ok) return [];
  const data = await resp.json();
  return data.history || [];
}

export function summarizeMarket(market, index) {
  if (!market) return { index, error: 'Market metadata unavailable' };

  let outcomePrices = market.outcomePrices;
  if (typeof outcomePrices === 'string') {
    try { outcomePrices = JSON.parse(outcomePrices); } catch { outcomePrices = []; }
  }

  let tags = [];
  const eventTags = market.events?.[0]?.tags || [];
  if (Array.isArray(eventTags)) {
    tags = eventTags.map((t) => t.label || t.slug).filter(Boolean);
  }

  return {
    index,
    question: market.question,
    currentYesPrice: outcomePrices?.[0] != null ? Number(outcomePrices[0]) : null,
    endDate: market.endDateIso || market.endDate || null,
    closed: !!market.closed,
    volume: market.volume ? Number(market.volume) : null,
    liquidity: market.liquidity ? Number(market.liquidity) : null,
    tags,
  };
}
