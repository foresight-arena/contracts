/**
 * Post-processing of model forecasts before commit.
 *
 * shrinkToMarket: final = market + k · (model − market). Historical analysis
 * (tools/analyze-history.mjs, rounds 2–95) showed the benchmark LLMs lose to the
 * market on moderate/opinion deviations; k≈0.5 turned every agent's alpha
 * positive in both halves of the data. k=1 leaves the forecast unchanged.
 */

export function parseShrinkFactor(value) {
  if (value == null || value === '') return 1;
  const k = Number(value);
  if (!Number.isFinite(k) || k < 0 || k > 1) {
    throw new Error(`Invalid SHRINK_TO_MARKET: ${value} (must be a number between 0 and 1)`);
  }
  return k;
}

/**
 * @param {number} bps     model forecast in basis points
 * @param {number|null} marketPrice  current YES price, 0–1 (null = unknown)
 * @param {number} k       weight on the model's deviation from the market
 * @returns {number} forecast in basis points (integer, 0–10000)
 */
export function shrinkToMarket(bps, marketPrice, k) {
  if (k === 1 || marketPrice == null || !Number.isFinite(marketPrice)) return bps;
  const marketBps = marketPrice * 10000;
  const shrunk = Math.round(marketBps + k * (bps - marketBps));
  return Math.min(10000, Math.max(0, shrunk));
}
