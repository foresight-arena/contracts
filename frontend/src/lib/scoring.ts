/**
 * Murphy decomposition + Alpha anatomy (Foresight Arena paper, Section 3).
 * All computations operate on probabilities in [0, 1].
 */

export interface MarketSample {
  p: number;     // agent prediction in [0, 1]
  x: 0 | 1;      // outcome (1 if YES, 0 if NO; VOID markets skipped before)
  b: number;     // benchmark in [0, 1]
}

export interface MurphyComponents {
  brier: number;
  unc: number;   // outcome variance, common across forecasters
  rel: number;   // calibration error (lower = better)
  res: number;   // resolution / discriminative power (higher = better)
}

export interface AgentScoring {
  n: number;                 // number of scored markets
  outcomeRate: number;       // ō
  agent: MurphyComponents;
  baseline: MurphyComponents;
  // Alpha anatomy
  avgAlpha: number;          // mean δ_i = (b−x)² − (p−x)²
  resolutionGain: number;    // RES_agent − RES_base
  reliabilityGap: number;    // REL_base − REL_agent
  alphaSE: number;           // standard error of ᾱ
  deltas: number[];          // per-market δ_i (in [0,1] units; multiply by 100 for %)
}

const NUM_BINS = 10;

/**
 * Compute Murphy decomposition for a single forecaster's predictions.
 * Bins predictions into K equal-width bins on [0, 1].
 */
function murphy(probs: number[], outcomes: number[]): MurphyComponents {
  const n = probs.length;
  if (n === 0) return { brier: 0, unc: 0, rel: 0, res: 0 };

  let brierSum = 0;
  for (let i = 0; i < n; i++) brierSum += (probs[i] - outcomes[i]) ** 2;
  const brier = brierSum / n;

  const meanOutcome = outcomes.reduce((s, v) => s + v, 0) / n;
  const unc = meanOutcome * (1 - meanOutcome);

  // Binning
  const binCount = new Array(NUM_BINS).fill(0);
  const binPredSum = new Array(NUM_BINS).fill(0);
  const binOutcomeSum = new Array(NUM_BINS).fill(0);
  for (let i = 0; i < n; i++) {
    let k = Math.floor(probs[i] * NUM_BINS);
    if (k >= NUM_BINS) k = NUM_BINS - 1; // p === 1.0 goes into last bin
    binCount[k]++;
    binPredSum[k] += probs[i];
    binOutcomeSum[k] += outcomes[i];
  }

  let rel = 0, res = 0;
  for (let k = 0; k < NUM_BINS; k++) {
    if (binCount[k] === 0) continue;
    const pBar = binPredSum[k] / binCount[k];
    const oBar = binOutcomeSum[k] / binCount[k];
    rel += binCount[k] * (pBar - oBar) ** 2;
    res += binCount[k] * (oBar - meanOutcome) ** 2;
  }
  rel /= n;
  res /= n;

  return { brier, unc, rel, res };
}

export function computeAgentScoring(samples: MarketSample[]): AgentScoring {
  const n = samples.length;
  const outcomes = samples.map((s) => s.x);

  const agent = murphy(samples.map((s) => s.p), outcomes);
  const baseline = murphy(samples.map((s) => s.b), outcomes);

  const meanOutcome = n > 0 ? outcomes.reduce((s: number, v) => s + v, 0) / n : 0;

  // Per-market delta and SE of mean alpha
  const deltas: number[] = new Array(n);
  let deltaSum = 0;
  let deltaSqSum = 0;
  for (let i = 0; i < n; i++) {
    const s = samples[i];
    const delta = (s.b - s.x) ** 2 - (s.p - s.x) ** 2;
    deltas[i] = delta;
    deltaSum += delta;
    deltaSqSum += delta * delta;
  }
  const avgAlpha = n > 0 ? deltaSum / n : 0;
  // Sample variance of δ_i, then SE of mean
  const deltaVar = n > 1 ? (deltaSqSum / n - avgAlpha * avgAlpha) * (n / (n - 1)) : 0;
  const alphaSE = n > 0 ? Math.sqrt(Math.max(0, deltaVar) / n) : 0;

  return {
    n,
    outcomeRate: meanOutcome,
    agent,
    baseline,
    avgAlpha,
    resolutionGain: agent.res - baseline.res,
    reliabilityGap: baseline.rel - agent.rel,
    alphaSE,
    deltas,
  };
}
