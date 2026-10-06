/**
 * Shared helpers for the history tools: CLI args, market categories (from the
 * question text — Polymarket tags are empty for these markets), stats and
 * markdown formatting.
 */

export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '');
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) args[key] = true; // boolean flag
    else { args[key] = next; i++; }
  }
  return args;
}

export const CATEGORIES = [
  ['crypto', /\b(bitcoin|ethereum|solana|xrp|dogecoin|btc|eth|crypto)\b/i],
  ['esports', /^game \d+:|penta kill|ultra kill|baron|dragon|inhibitor|blast|counter-strike|dota|valorant|league of legends|\bmap \d/i],
  ['social-posts', /\bpost\b.*\b(tweets|posts)\b|truth social/i],
  ['weather-nature', /temperature|earthquake|space weather|rain|snow|hurricane|tornado/i],
  ['stocks-macro', /\([A-Z]{1,5}\)|s&p|wti|crude|gold|earnings|nasdaq|fed |interest rate|cpi|tsa passengers/i],
  ['sports', / win on |\bvs\.? |\bfc\b|fight to go|premier league|nba|nfl|mlb|nhl|ufc|halftime|draw|relegat|finish in/i],
  ['politics', /election|nominee|approval rating|senate|president|mayor|parliament|minister|tie be/i],
  ['culture-tech', /spotify|song|billboard|box office|app store|album|netflix|openai|revenue|ai model/i],
];

export function category(question = '') {
  for (const [name, re] of CATEGORIES) if (re.test(question)) return name;
  return 'other';
}

/** Multi-bucket markets ("between", "exactly", "N-M posts") vs simple thresholds. */
export function marketShape(question = '') {
  return /between|exactly|\d+\s*-\s*\d+ (tweets|posts)|\bbe \d+°c\b/i.test(question) ? 'range' : 'threshold';
}

// ─── Stats ────────────────────────────────────────────────────────────────────

export const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN);

// Deterministic RNG so the report is reproducible
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** 95% CI of mean(value) with rounds resampled as clusters. */
export function clusteredCI(items, value, iters = 2000) {
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

export const f = (x, d = 4) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(d) : '–');
export const g = (x, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : '–');
export const pct = (x) => (Number.isFinite(x) ? `${(x * 100).toFixed(0)}%` : '–');

export function table(headers, body) {
  return [
    `| ${headers.join(' | ')} |`,
    `|${headers.map(() => '---').join('|')}|`,
    ...body.map((r) => `| ${r.join(' | ')} |`),
  ].join('\n');
}
