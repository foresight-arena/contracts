#!/usr/bin/env node
/**
 * Per-agent benchmark summary + round-level stats over an export from
 * export-history.mjs (needs `resolvedAt` / `revealStart`, i.e. a current export).
 *
 * Per agent: rounds, scored predictions, active period, mean alpha (95% CI,
 * clustered by round), and a Murphy decomposition of the Brier score against
 * the market price on the same markets:
 *   Brier = reliability − resolution + uncertainty
 *   resolution gain = agent resolution − market resolution   (higher = better discrimination)
 *   reliability gap = agent reliability − market reliability (lower = better calibrated)
 *   alpha ≈ resolution gain − reliability gap  (up to binning error)
 *
 * Usage:
 *   node summary.mjs [--in out/history-full.json] [--agents name1,name2] [--out out/summary.md]
 */

import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { parseArgs, category, mean, clusteredCI, f, g, pct, table } from './lib/common.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_AGENTS = [
  'benchmark-claude-fable-5.1',
  'benchmark-amazon-nova-2-lite',
  'benchmark-opus-4.7',
  'benchmark-gpt-5.4',
  'benchmark-grok-4.1-fast',
  'benchmark-claude-sonnet-4.6',
  'Random',
];

const args = parseArgs(process.argv.slice(2));
const inPath = args.in || join(HERE, 'out', 'history-full.json');
const agents = args.agents ? args.agents.split(',') : DEFAULT_AGENTS;
const data = JSON.parse(readFileSync(inPath, 'utf-8'));
const short = (name) => name.replace(/^benchmark-/, '').replace(/^(claude|amazon)-/, '');
const ts = (iso) => (iso ? Date.parse(iso) : Infinity);

// ─── Rows: one per (agent, scored market) ─────────────────────────────────────

const rows = [];
for (const r of data.rounds) {
  for (const a of r.agents) {
    if (!agents.includes(a.name)) continue;
    for (const pm of a.perMarket) {
      const m = r.markets[pm.index];
      if (!m?.scored || pm.alpha == null) continue;
      rows.push({
        agent: a.name,
        round: r.roundId,
        date: r.commitDeadline.slice(0, 10),
        category: category(m.question),
        p: pm.predictionBps / 1e4,
        m: m.benchmarkBps / 1e4,
        o: m.outcome === 'YES' ? 1 : 0,
        alpha: pm.alpha,
        brier: pm.brier,
        mBrier: m.benchmarkBrier,
        // Settled on the CTF before the commit deadline: agents that check the
        // CTF auto-fill these, so they say nothing about forecasting skill
        preResolved: ts(m.resolvedAt) <= ts(r.commitDeadline),
      });
    }
  }
}

// ─── Murphy decomposition ─────────────────────────────────────────────────────

const BINS = 10;
function murphy(pairs) {
  // pairs: [{ f, o }] — forecast in [0,1], outcome 0/1
  const n = pairs.length;
  const base = mean(pairs.map((x) => x.o));
  const bins = Array.from({ length: BINS }, () => []);
  for (const x of pairs) bins[Math.min(BINS - 1, Math.floor(x.f * BINS))].push(x);
  let rel = 0, res = 0;
  for (const b of bins) {
    if (!b.length) continue;
    const fBar = mean(b.map((x) => x.f));
    const oBar = mean(b.map((x) => x.o));
    rel += (b.length / n) * (fBar - oBar) ** 2;
    res += (b.length / n) * (oBar - base) ** 2;
  }
  return { rel, res, unc: base * (1 - base) };
}

// ─── 1. Agent summary ─────────────────────────────────────────────────────────

const out = [];
const roundsAll = data.rounds;
out.push(`# Benchmark summary

Source: \`${inPath.split('/').slice(-2).join('/')}\` (exported ${data.exportedAt.slice(0, 10)}), ${roundsAll.length} rounds with outcomes (${Math.min(...roundsAll.map((r) => r.roundId))}–${Math.max(...roundsAll.map((r) => r.roundId))}). Scored markets only; VOID (50/50) resolutions are not scored on-chain.
Alpha per market = market Brier − agent Brier (positive = beat the market price at the commit deadline). CI: 95% bootstrap resampling whole rounds.
"Excl. pre-resolved" drops markets already settled on the CTF before the commit deadline (free alpha for any agent that checks the CTF).`);

const summaryBody = agents.map((name) => {
  const s = rows.filter((r) => r.agent === name);
  if (!s.length) return [short(name), 0, 0, '–', '–', '–', '–', '–', '–', '–'];
  const rounds = [...new Set(s.map((r) => r.round))];
  const dates = s.map((r) => r.date).sort();
  const [lo, hi] = clusteredCI(s, (r) => r.alpha);
  const clean = s.filter((r) => !r.preResolved);
  const agentM = murphy(s.map((r) => ({ f: r.p, o: r.o })));
  const marketM = murphy(s.map((r) => ({ f: r.m, o: r.o })));
  return [
    short(name),
    rounds.length,
    s.length,
    `${dates[0]} → ${dates.at(-1)}`,
    f(mean(s.map((r) => r.alpha))),
    `${f(lo)} … ${f(hi)}`,
    `${f(mean(clean.map((r) => r.alpha)))} (${clean.length})`,
    `${g(mean(s.map((r) => r.brier)))} / ${g(mean(s.map((r) => r.mBrier)))}`,
    f(agentM.res - marketM.res),
    f(agentM.rel - marketM.rel),
  ];
});
out.push(`## 1. Agents

${table(['agent', 'rounds', 'scored predictions', 'active period', 'mean alpha', '95% CI', 'alpha excl. pre-resolved (n)', 'Brier agent / market', 'resolution gain', 'reliability gap'], summaryBody)}

Resolution gain > 0: separates YES from NO outcomes better than the market. Reliability gap > 0: worse calibrated than the market.`);

// ─── 2. Round stats: already-resolved markets ────────────────────────────────

const roundStats = roundsAll.map((r) => {
  const scoredOrVoid = r.markets.filter((m) => m.outcome);
  return {
    round: r.roundId,
    markets: r.markets.length,
    atCommit: r.markets.filter((m) => ts(m.resolvedAt) <= ts(r.commitDeadline)).length,
    atReveal: r.markets.filter((m) => ts(m.resolvedAt) <= ts(r.revealStart)).length,
    resolved: scoredOrVoid.length,
    scored: r.markets.filter((m) => m.scored).length,
  };
});
const share = (pred) => roundStats.filter(pred).length / roundStats.length;
out.push(`## 2. Already-resolved markets per round

Across ${roundStats.length} rounds (${mean(roundStats.map((r) => r.markets)).toFixed(1)} markets per round on average). "Resolved" = settled on the CTF (YES, NO or VOID).

${table(['moment', 'rounds with ≥1 resolved market', 'avg resolved markets per round', 'avg share of the round'], [
  ['commit deadline', pct(share((r) => r.atCommit > 0)), g(mean(roundStats.map((r) => r.atCommit)), 2), pct(mean(roundStats.map((r) => r.atCommit / r.markets)))],
  ['reveal opens', pct(share((r) => r.atReveal > 0)), g(mean(roundStats.map((r) => r.atReveal)), 2), pct(mean(roundStats.map((r) => r.atReveal / r.markets)))],
  ['outcomes triggered (scored)', pct(share((r) => r.scored > 0)), g(mean(roundStats.map((r) => r.scored)), 2), pct(mean(roundStats.map((r) => r.scored / r.markets)))],
])}

Distribution of markets already resolved when the reveal window opens:

${table(['resolved at reveal', 'rounds', 'share'], [...new Set(roundStats.map((r) => r.atReveal))].sort((a, b) => a - b).map((k) => {
  const n = roundStats.filter((r) => r.atReveal === k).length;
  return [k, n, pct(n / roundStats.length)];
}))}`);

// ─── 3. Category distribution ─────────────────────────────────────────────────

const allMarkets = roundsAll.flatMap((r) => r.markets.map((m) => ({ ...m, round: r.roundId, category: category(m.question) })));
const cats = [...new Set(allMarkets.map((m) => m.category))].sort((a, b) =>
  allMarkets.filter((m) => m.category === b).length - allMarkets.filter((m) => m.category === a).length);
out.push(`## 3. Market categories

Categories come from the question text (Polymarket tags are empty for these markets).

${table(['category', 'markets', 'share of markets', 'rounds containing it', 'scored markets'], cats.map((c) => {
  const ms = allMarkets.filter((m) => m.category === c);
  return [c, ms.length, pct(ms.length / allMarkets.length), pct(new Set(ms.map((m) => m.round)).size / roundsAll.length), ms.filter((m) => m.scored).length];
}))}`);

// ─── 4. Alpha per category ────────────────────────────────────────────────────

const llm = (r) => r.agent !== 'Random';
out.push(`## 4. Mean alpha per category

Cells: mean alpha (scored predictions). "All LLMs" pools every agent except Random.

${table(['category', 'all LLMs', ...agents.map(short)], cats.map((c) => {
  const sel = rows.filter((r) => r.category === c);
  const pooled = sel.filter(llm);
  return [
    c,
    pooled.length ? `${f(mean(pooled.map((r) => r.alpha)))} (${pooled.length})` : '–',
    ...agents.map((a) => {
      const s = sel.filter((r) => r.agent === a);
      return s.length ? `${f(mean(s.map((r) => r.alpha)))} (${s.length})` : '–';
    }),
  ];
}))}`);

const outPath = args.out || join(HERE, 'out', 'summary.md');
writeFileSync(outPath, out.join('\n\n') + '\n');
console.error(`Wrote ${outPath} (${rows.length} agent-market rows)`);
