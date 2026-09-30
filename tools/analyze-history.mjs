#!/usr/bin/env node
/**
 * Quantitative post-mortem over an export from export-history.mjs.
 *
 * Only scored markets are used (the ones that count on-chain). Alpha is per
 * market: marketBrier - agentBrier (positive = beat the market price at commit
 * deadline). Confidence intervals use a bootstrap clustered by round, since
 * markets in one round share a news cycle.
 *
 * Usage:
 *   node analyze-history.mjs [--in out/history-all.json] [--to-round 95] [--agents name1,name2] [--out out/analysis.md]
 */

import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) args[argv[i].replace(/^--/, '')] = argv[i + 1];
  return args;
}

const CATEGORIES = [
  ['crypto', /\b(bitcoin|ethereum|solana|xrp|dogecoin|btc|eth|crypto)\b/i],
  ['esports', /^game \d+:|penta kill|ultra kill|baron|dragon|inhibitor|blast|counter-strike|dota|valorant|league of legends|\bmap \d/i],
  ['social-posts', /\bpost\b.*\b(tweets|posts)\b|truth social/i],
  ['weather-nature', /temperature|earthquake|space weather|rain|snow|hurricane|tornado/i],
  ['stocks-macro', /\([A-Z]{1,5}\)|s&p|wti|crude|gold|earnings|nasdaq|fed |interest rate|cpi|tsa passengers/i],
  ['sports', / win on |\bvs\.? |\bfc\b|fight to go|premier league|nba|nfl|mlb|nhl|ufc|halftime|draw|relegat|finish in/i],
  ['politics', /election|nominee|approval rating|senate|president|mayor|parliament|minister|tie be/i],
  ['culture-tech', /spotify|song|billboard|box office|app store|album|netflix|openai|revenue|ai model/i],
];

function category(question = '') {
  for (const [name, re] of CATEGORIES) if (re.test(question)) return name;
  return 'other';
}

/** Multi-bucket markets ("between", "exactly", "N-M posts") vs simple thresholds. */
function marketShape(question = '') {
  return /between|exactly|\d+\s*-\s*\d+ (tweets|posts)|\bbe \d+°c\b/i.test(question) ? 'range' : 'threshold';
}

// ─── Load ─────────────────────────────────────────────────────────────────────

const args = parseArgs(process.argv.slice(2));
const inPath = args.in || join(HERE, 'out', 'history-all.json');
const toRound = args['to-round'] ? Number(args['to-round']) : Infinity;
const agentFilter = args.agents ? args.agents.split(',') : null;
const data = JSON.parse(readFileSync(inPath, 'utf-8'));

// One row per (agent, scored market)
const rows = [];
for (const r of data.rounds) {
  if (r.roundId > toRound) continue;
  for (const a of r.agents) {
    const name = a.name || a.address.slice(0, 10);
    if (agentFilter ? !agentFilter.includes(name) : !/^benchmark-/.test(name)) continue;
    for (const pm of a.perMarket) {
      const m = r.markets[pm.index];
      if (!m?.scored || pm.alpha == null) continue;
      rows.push({
        agent: name,
        round: r.roundId,
        index: pm.index,
        question: m.question,
        category: category(m.question),
        shape: marketShape(m.question),
        p: pm.predictionBps / 1e4,
        m: m.benchmarkBps / 1e4,
        o: m.outcome === 'YES' ? 1 : 0,
        brier: pm.brier,
        mBrier: m.benchmarkBrier,
        alpha: pm.alpha,
        reasoning: pm.reasoning,
      });
    }
  }
}
const agents = [...new Set(rows.map((r) => r.agent))].sort();

// ─── Stats helpers ────────────────────────────────────────────────────────────

const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN);

// Deterministic RNG so the report is reproducible
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** 95% CI of mean(value) with rounds resampled as clusters. */
function clusteredCI(items, value, iters = 2000) {
  const byRound = new Map();
  for (const it of items) {
    if (!byRound.has(it.round)) byRound.set(it.round, []);
    byRound.get(it.round).push(value(it));
  }
  const clusters = [...byRound.values()];
  if (clusters.length < 5) return [NaN, NaN];
  const rand = rng(42);
  const stats = [];
  for (let i = 0; i < iters; i++) {
    let sum = 0, n = 0;
    for (let j = 0; j < clusters.length; j++) {
      const c = clusters[Math.floor(rand() * clusters.length)];
      for (const v of c) { sum += v; n++; }
    }
    stats.push(sum / n);
  }
  stats.sort((a, b) => a - b);
  return [stats[Math.floor(iters * 0.025)], stats[Math.floor(iters * 0.975)]];
}

const f = (x, d = 4) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(d) : '–');
const g = (x, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : '–');
const pct = (x) => (Number.isFinite(x) ? `${(x * 100).toFixed(0)}%` : '–');

function table(headers, body) {
  return [
    `| ${headers.join(' | ')} |`,
    `|${headers.map(() => '---').join('|')}|`,
    ...body.map((r) => `| ${r.join(' | ')} |`),
  ].join('\n');
}

/** Rows grouped by `key`, one line per group per agent-set ("all LLMs" pooled + each agent). */
function breakdown(title, key, order) {
  const groups = order || [...new Set(rows.map(key))].sort();
  const body = groups.map((grp) => {
    const sel = rows.filter((r) => key(r) === grp);
    return [
      grp,
      sel.length,
      f(mean(sel.map((r) => r.alpha))),
      ...agents.map((a) => {
        const s = sel.filter((r) => r.agent === a);
        return s.length ? `${f(mean(s.map((r) => r.alpha)))} (${s.length})` : '–';
      }),
    ];
  });
  return `### ${title}\n\n${table([title.split(' ')[0], 'n', 'all LLMs', ...agents], body)}`;
}

// ─── Sections ─────────────────────────────────────────────────────────────────

const out = [];
const rounds = [...new Set(rows.map((r) => r.round))];
out.push(`# Benchmark post-mortem — quantitative pass

Source: \`${inPath.split('/').slice(-2).join('/')}\`, rounds ${Math.min(...rounds)}–${Math.max(...rounds)}, scored markets only.
Alpha per market = market Brier − agent Brier (positive = beat the market price at commit deadline).
CIs: 95% bootstrap, resampling whole rounds.`);

// Overall
out.push(`## 1. Overall\n\n${table(
  ['agent', 'markets', 'rounds', 'mean alpha', '95% CI', 'agent Brier', 'market Brier (same mkts)'],
  [...agents, 'all LLMs'].map((a) => {
    const s = a === 'all LLMs' ? rows : rows.filter((r) => r.agent === a);
    const [lo, hi] = clusteredCI(s, (r) => r.alpha);
    return [a, s.length, new Set(s.map((r) => r.round)).size, f(mean(s.map((r) => r.alpha))), `${f(lo)} … ${f(hi)}`,
      g(mean(s.map((r) => r.brier))), g(mean(s.map((r) => r.mBrier)))];
  }),
)}`);

// Over time
const period = (r) => {
  const lo = Math.floor((r.round - 2) / 20) * 20 + 2;
  return `${String(lo).padStart(3, '0')}-${lo + 19}`;
};
out.push(`## 2. Over time\n\n${breakdown('Rounds (20-round blocks)', period)}`);

// By category and shape
out.push(`## 3. By market type\n\n${breakdown('Category', (r) => r.category)}\n\n${breakdown('Shape (range = one bucket of a multi-outcome event)', (r) => r.shape)}`);

// By market price
const PRICE_BUCKETS = [[0, 0.05, '<5%'], [0.05, 0.2, '5–20%'], [0.2, 0.4, '20–40%'], [0.4, 0.6, '40–60%'], [0.6, 0.8, '60–80%'], [0.8, 0.95, '80–95%'], [0.95, 1.01, '>95%']];
const priceBucket = (r) => PRICE_BUCKETS.find(([lo, hi]) => r.m >= lo && r.m < hi)[2];
out.push(`## 4. By market price at commit\n\n${breakdown('Price bucket', priceBucket, PRICE_BUCKETS.map((b) => b[2]))}`);

// Deviation from market
const DEV_BUCKETS = [[0, 0.02, '<2pp'], [0.02, 0.05, '2–5pp'], [0.05, 0.1, '5–10pp'], [0.1, 0.2, '10–20pp'], [0.2, 1.01, '>20pp']];
const devBucket = (r) => DEV_BUCKETS.find(([lo, hi]) => Math.abs(r.p - r.m) >= lo && Math.abs(r.p - r.m) < hi)[2];
const devBody = DEV_BUCKETS.map(([, , label]) => {
  const s = rows.filter((r) => devBucket(r) === label);
  // Direction hit: moved toward the actual outcome
  const moved = s.filter((r) => r.p !== r.m);
  const hits = moved.filter((r) => (r.p > r.m) === (r.o === 1));
  return [label, s.length, pct(s.length / rows.length), f(mean(s.map((r) => r.alpha))), pct(hits.length / moved.length)];
});
out.push(`## 5. Deviation from the market price

How far agents moved away from the market, and whether it paid off. "Right direction" = moved toward the actual outcome.

${table(['|p − market|', 'n', 'share', 'mean alpha', 'right direction'], devBody)}`);

// Shrinkage toward the market
const KS = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5];
const shrinkBody = [...agents, 'all LLMs'].map((a) => {
  const s = a === 'all LLMs' ? rows : rows.filter((r) => r.agent === a);
  const vals = KS.map((k) => mean(s.map((r) => {
    const q = Math.min(1, Math.max(0, r.m + k * (r.p - r.m)));
    return (r.m - r.o) ** 2 - (q - r.o) ** 2;
  })));
  const best = KS[vals.indexOf(Math.max(...vals))];
  return [a, ...vals.map((v) => f(v)), `k=${best}`];
});
out.push(`## 6. What if predictions were shrunk toward the market?

Forecast = market + k·(agent − market). k=0 is copying the market (alpha 0), k=1 is the agent as-is, k>1 exaggerates the agent's deviation.

${table(['agent', ...KS.map((k) => `k=${k}`), 'best'], shrinkBody)}`);

// Consensus of the LLMs
const byMarket = new Map();
for (const r of rows) {
  const key = `${r.round}:${r.index}`;
  if (!byMarket.has(key)) byMarket.set(key, []);
  byMarket.get(key).push(r);
}
const multi = [...byMarket.values()].filter((g2) => g2.length >= 3);
const consensus = multi.map((g2) => {
  const p = mean(g2.map((r) => r.p));
  const { m, o, round } = g2[0];
  const allSameSide = g2.every((r) => r.p > r.m) || g2.every((r) => r.p < r.m);
  return { round, alpha: (m - o) ** 2 - (p - o) ** 2, allSameSide };
});
const agree = consensus.filter((c) => c.allSameSide);
const [clo, chi] = clusteredCI(consensus, (c) => c.alpha);
out.push(`## 7. Ensemble of the LLMs

Markets predicted by ≥3 LLM agents: ${multi.length}. Averaging their forecasts:

${table(['forecast', 'markets', 'mean alpha', '95% CI'], [
  ['mean of agents', consensus.length, f(mean(consensus.map((c) => c.alpha))), `${f(clo)} … ${f(chi)}`],
  ['… only when all agents deviate the same way', agree.length, f(mean(agree.map((c) => c.alpha))), '–'],
  ['… when they disagree on direction', consensus.length - agree.length, f(mean(consensus.filter((c) => !c.allSameSide).map((c) => c.alpha))), '–'],
])}`);

// Calibration
const CAL = [[0, 0.1], [0.1, 0.3], [0.3, 0.5], [0.5, 0.7], [0.7, 0.9], [0.9, 1.01]];
const calBody = CAL.map(([lo, hi]) => {
  const a = rows.filter((r) => r.p >= lo && r.p < hi);
  const mk = rows.filter((r) => r.m >= lo && r.m < hi);
  return [`${pct(lo)}–${pct(Math.min(hi, 1))}`, a.length, pct(mean(a.map((r) => r.p))), pct(mean(a.map((r) => r.o))), mk.length, pct(mean(mk.map((r) => r.m))), pct(mean(mk.map((r) => r.o)))];
});
out.push(`## 8. Calibration (all LLM predictions vs market prices)

${table(['bin', 'agent n', 'agent avg forecast', 'agent YES rate', 'market n', 'market avg price', 'market YES rate'], calBody)}`);

// Confident "already decided" calls vs everything else
const confident = (r) => (r.p >= 0.9 || r.p <= 0.1) && Math.abs(r.p - r.m) >= 0.4;
const alphaAt = (r, q) => (r.m - r.o) ** 2 - (q - r.o) ** 2;
const sum = (xs) => xs.reduce((s, x) => s + x, 0);
const conf = rows.filter(confident);
const rest = rows.filter((r) => !confident(r));
const DEV_REST = [[0, 0.02, '<2pp'], [0.02, 0.05, '2–5pp'], [0.05, 0.1, '5–10pp'], [0.1, 0.2, '10–20pp'], [0.2, 1.01, '>20pp']];
out.push(`## 9. Confident calls against the market

"Confident" = agent at ≥90% or ≤10% and ≥40pp away from the market — typically the agent believes the event is already decided.

${table(['subset', 'n', 'right direction', 'total alpha', 'mean alpha'], [
  ['confident calls', conf.length, pct(conf.filter((r) => (r.p > r.m) === (r.o === 1)).length / conf.length), f(sum(conf.map((r) => r.alpha)), 2), f(mean(conf.map((r) => r.alpha)))],
  ...DEV_REST.map(([lo, hi, label]) => {
    const s = rest.filter((r) => Math.abs(r.p - r.m) >= lo && Math.abs(r.p - r.m) < hi);
    const moved = s.filter((r) => r.p !== r.m);
    return [`other, ${label} from market`, s.length, pct(moved.filter((r) => (r.p > r.m) === (r.o === 1)).length / moved.length), f(sum(s.map((r) => r.alpha)), 2), f(mean(s.map((r) => r.alpha)))];
  }),
])}`);

// Split-half robustness of the post-processing rules
const mid = Math.floor((Math.min(...rounds) + Math.max(...rounds)) / 2);
const RULES = [
  ['as-is', (r) => r.p],
  ['shrink all, k=0.5', (r) => r.m + 0.5 * (r.p - r.m)],
  ['keep confident, shrink rest k=0.5', (r) => (confident(r) ? r.p : r.m + 0.5 * (r.p - r.m))],
  ['keep confident, copy market otherwise', (r) => (confident(r) ? r.p : r.m)],
];
out.push(`## 10. Post-processing rules, split-half check

Mean alpha per market. A rule is only credible if it wins in both halves.

${table(['rule', `rounds ≤${mid}`, `rounds >${mid}`, 'all'], RULES.map(([name, q]) => [
  name,
  f(mean(rows.filter((r) => r.round <= mid).map((r) => alphaAt(r, q(r))))),
  f(mean(rows.filter((r) => r.round > mid).map((r) => alphaAt(r, q(r))))),
  f(mean(rows.map((r) => alphaAt(r, q(r))))),
]))}`);

// Worst markets
const worst = [...rows].sort((a, b) => a.alpha - b.alpha).slice(0, 20);
out.push(`## 11. Largest losses vs the market

${table(['round', 'agent', 'question', 'market', 'agent', 'outcome', 'alpha'], worst.map((r) => [
  r.round, r.agent.replace('benchmark-', ''), (r.question || '').slice(0, 70).replace(/\|/g, '/'), pct(r.m), pct(r.p), r.o ? 'YES' : 'NO', f(r.alpha, 3),
]))}`);

const outPath = args.out || join(HERE, 'out', 'analysis.md');
writeFileSync(outPath, out.join('\n\n') + '\n');
writeFileSync(outPath.replace(/\.md$/, '-rows.json'), JSON.stringify(rows, null, 1));
console.error(`Wrote ${outPath} (${rows.length} agent-market rows, ${agents.length} agents)`);
