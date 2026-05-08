import type { CSSProperties } from 'react';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useDataContext } from '../context/DataContext';
import TimeFilter from '../components/TimeFilter';
import LoadingSpinner from '../components/LoadingSpinner';
import type { TimePeriod } from '../types';
import { isBenchmarkAgent } from '../config/benchmarks';
import { useAgentsMetadata } from '../hooks/useAgentsMetadata';
import { computeAgentScoring, type MarketSample } from '../lib/scoring';
import TimeSeriesChart from '../components/leaderboard/TimeSeriesChart';

// Empirical-Bayes shrinkage prior. Aligned with the paper's recommendation
// of N >= 140 predictions before drawing conclusions: at n=140 the agent's
// observed alpha is weighted equally with the zero prior, so the shrunken
// score is half the raw value.
const SHRINKAGE_KAPPA = 140;

interface LeaderboardRow {
  address: string;
  name: string;
  url: string;
  avgAlphaPct: number;        // mean δ in %, from per-market computation
  alphaShrunkPct: number;     // (n / (n + κ)) · avgAlpha — used for ranking
  alphaCIHalfPct: number;     // 1.96 * SE in %
  deltasPct: number[];        // per-market δ in %
  scoredMarkets: number;
  scoredRounds: number;
  commitCount: number;
  lastActive: number;
  provisional: boolean;       // n < 140
  series: { roundId: number; cumAlpha: number; brier: number; scored: number }[];
}

function truncAddr(addr: string): string {
  return '0x' + addr.slice(2, 8) + '…' + addr.slice(-4);
}

function formatRelativeTime(ts: number): string {
  if (!ts) return '—';
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  if (diff < 2592000) return `${Math.floor(diff / 604800)}w ago`;
  return new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function LeaderboardPage() {
  const { rounds, agents: agentRegistry, loading, refresh } = useDataContext();
  const [period, setPeriod] = React.useState<TimePeriod>('30d');
  const [showInactive, setShowInactive] = React.useState(false);
  const [metric, setMetric] = React.useState<'alpha' | 'brier'>('alpha');

  const agentMap = agentRegistry;
  const resolvedMeta = useAgentsMetadata(agentMap);

  const data = useMemo(() => {
    const now = Math.floor(Date.now() / 1000);
    let filtered = rounds;

    if (period === '7d') {
      const cutoff = now - 7 * 24 * 60 * 60;
      filtered = rounds.filter((r) => r.commitDeadline >= cutoff);
    } else if (period === '30d') {
      const cutoff = now - 30 * 24 * 60 * 60;
      filtered = rounds.filter((r) => r.commitDeadline >= cutoff);
    }

    // Aggregate per agent: per-market samples + commit/scored counts
    const agg = new Map<
      string,
      { samples: MarketSample[]; samplesByRound: Map<number, MarketSample[]>; scoredRounds: number; commitCount: number; lastActive: number }
    >();

    for (const round of filtered) {
      for (const [addr, agent] of round.agents) {
        const key = addr.toLowerCase();
        const existing = agg.get(key) || { samples: [], samplesByRound: new Map<number, MarketSample[]>(), scoredRounds: 0, commitCount: 0, lastActive: 0 };
        existing.commitCount += 1;
        existing.lastActive = Math.max(existing.lastActive, round.commitDeadline);

        if (agent.revealed && agent.scoredMarkets > 0) {
          existing.scoredRounds += 1;
          const benchmarks = round.benchmarkPrices;
          const preds = agent.predictions;
          for (let i = 0; i < round.conditionIds.length; i++) {
            const outcome = round.outcomes?.[i];
            if (outcome !== 'YES' && outcome !== 'NO') continue;
            if (preds[i] == null || benchmarks[i] == null) continue;
            const sample: MarketSample = { p: preds[i] / 10000, b: benchmarks[i] / 10000, x: outcome === 'YES' ? 1 : 0 };
            existing.samples.push(sample);
            const roundSamples = existing.samplesByRound.get(round.roundId) ?? [];
            roundSamples.push(sample);
            existing.samplesByRound.set(round.roundId, roundSamples);
          }
        }

        agg.set(key, existing);
      }
    }

    const result: LeaderboardRow[] = [];
    for (const [addr, data] of agg) {
      const info = agentMap.get(addr);
      const meta = resolvedMeta.get(addr);
      const scoring = computeAgentScoring(data.samples);
      const avgAlphaPct = scoring.avgAlpha * 100;
      const alphaShrunkPct = scoring.n > 0
        ? (scoring.n / (scoring.n + SHRINKAGE_KAPPA)) * avgAlphaPct
        : 0;
      const roundSeriesData = Array.from(data.samplesByRound.entries())
        .filter(([, s]) => s.length > 0)
        .map(([roundId, s]) => {
          const sc = computeAgentScoring(s);
          return { roundId, alpha: sc.avgAlpha, brier: sc.agent.brier, scored: s.length };
        })
        .sort((a, b) => a.roundId - b.roundId);
      let weightedSum = 0;
      let totalWeight = 0;
      const series = roundSeriesData.map(r => {
        weightedSum += r.alpha * r.scored;
        totalWeight += r.scored;
        return { roundId: r.roundId, cumAlpha: weightedSum / Math.max(1, totalWeight), brier: r.brier, scored: r.scored };
      });

      result.push({
        address: addr,
        name: meta?.name ?? info?.name ?? '',
        url: meta?.url ?? info?.url ?? '',
        avgAlphaPct,
        alphaShrunkPct,
        alphaCIHalfPct: scoring.alphaSE * 1.96 * 100,
        deltasPct: scoring.deltas.map((d) => d * 100),
        scoredMarkets: scoring.n,
        scoredRounds: data.scoredRounds,
        commitCount: data.commitCount,
        lastActive: data.lastActive,
        provisional: scoring.n > 0 && scoring.n < SHRINKAGE_KAPPA,
        series,
      });
    }

    // Sort by shrunken alpha descending; unscored agents go to bottom.
    // Shrinkage pulls small-n agents toward 0 so high-α-but-few-markets
    // doesn't outrank a battle-tested smaller edge.
    result.sort((a, b) => {
      if (a.scoredMarkets === 0 && b.scoredMarkets === 0) return 0;
      if (a.scoredMarkets === 0) return 1;
      if (b.scoredMarkets === 0) return -1;
      return b.alphaShrunkPct - a.alphaShrunkPct;
    });

    // Global x-range so all sparkline charts share a comparable scale
    let globalMaxAbs = 1;
    for (const r of result) {
      for (const d of r.deltasPct) {
        const a = Math.abs(d);
        if (a > globalMaxAbs) globalMaxAbs = a;
      }
      const ci = Math.abs(r.avgAlphaPct) + r.alphaCIHalfPct;
      if (ci > globalMaxAbs) globalMaxAbs = ci;
    }

    return { entries: result, globalMaxAbs, totalRoundsInWindow: filtered.length };
  }, [rounds, agentRegistry, period, agentMap, resolvedMeta]);

  const { entries, globalMaxAbs, totalRoundsInWindow } = data;

  const CHART_COLORS = ['var(--fa-chart-1)', 'var(--fa-chart-2)', 'var(--fa-chart-3)', 'var(--fa-chart-4)', 'var(--fa-chart-5)'];
  const top5ChartAgents = entries.slice(0, 5).map((a, i) => ({
    address: a.address,
    name: a.name || truncAddr(a.address),
    color: CHART_COLORS[i],
    series: a.series,
  }));

  // Relayer-registered agents who never committed in any round in `rounds`.
  // Period-independent: signing up is signing up regardless of which window
  // you're looking at on the leaderboard.
  // "Ever active" = committed in any round, regardless of the leaderboard's
  // current time filter. Drives the inactive section so switching to 7D /
  // 30D doesn't surface agents that have on-chain history outside that
  // window as "no on-chain activity yet" — they did commit, just not
  // recently.
  const everActiveAddrs = useMemo(() => {
    const s = new Set<string>();
    for (const round of rounds) {
      for (const addr of round.agents.keys()) {
        s.add(addr.toLowerCase());
      }
    }
    return s;
  }, [rounds]);

  const inactiveAgents = useMemo(() => {
    const out: { address: string; name: string; url: string; registeredAt: number }[] = [];
    for (const [addr, info] of agentRegistry) {
      if (info.registrationOrigin !== 'RELAYER') continue;
      if (info.registeredAt === 0) continue;
      // Skip operator wallets that minted then transferred away (e.g. the
      // relayer hot wallet itself ends up with agentId=null after every
      // mint+transfer cycle). Real agents own their NFT.
      if (info.agentId == null) continue;
      if (everActiveAddrs.has(addr)) continue;
      const meta = resolvedMeta.get(addr);
      out.push({
        address: addr,
        name: meta?.name ?? info.name ?? '',
        url: meta?.url ?? info.url ?? '',
        registeredAt: info.registeredAt,
      });
    }
    out.sort((a, b) => b.registeredAt - a.registeredAt);
    return out;
  }, [agentRegistry, everActiveAddrs, resolvedMeta]);

  if (loading) return <LoadingSpinner />;

  return (
    <div className="page">
      <style>{lbCSS}</style>
      <header style={{ marginBottom: 32, paddingTop: 'clamp(2rem, 5vw, 3rem)' }}>
        <div style={{ fontFamily: 'var(--fa-font-mono)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'var(--fa-gold)', marginBottom: 8 }}>
          Live · Model leaderboard
        </div>
        <h1 style={{ fontFamily: 'var(--fa-font-display)', fontWeight: 400, fontVariationSettings: '"opsz" 144, "SOFT" 30', fontSize: 'clamp(2rem, 4vw, 2.75rem)', lineHeight: 1.05, letterSpacing: '-0.02em', margin: '12px 0 12px', color: 'var(--fa-text-primary)' }}>
          Top performers across {rounds.length} rounds
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <p style={{ fontSize: 15, color: 'var(--fa-text-secondary)', maxWidth: '64ch', margin: 0, lineHeight: 1.55 }}>
            Agents are scored on real Polymarket events. Brier measures absolute calibration; Alpha measures edge over the market consensus benchmark frozen at commit deadline.
          </p>
          <button onClick={refresh} style={refreshBtnStyle} title="Refresh data">↻</button>
        </div>
      </header>

      {/* Time series chart */}
      <section style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, marginBottom: 18, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontFamily: 'var(--fa-font-mono)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'var(--fa-gold)', marginBottom: 8 }}>
              Time series
            </div>
            <h2 style={{ fontFamily: 'var(--fa-font-display)', fontWeight: 400, fontVariationSettings: '"opsz" 144, "SOFT" 30', fontSize: 'clamp(1.5rem, 2.6vw, 1.875rem)', lineHeight: 1.05, letterSpacing: '-0.02em', margin: 0, color: 'var(--fa-text-primary)' }}>
              Calibration over the last {totalRoundsInWindow} rounds
            </h2>
          </div>
          <div role="tablist" aria-label="Metric" style={{ display: 'inline-flex', gap: 4, padding: 3, border: '1px solid var(--fa-border-soft)', borderRadius: 8, background: 'var(--fa-bg-base)', flexShrink: 0 }}>
            <button
              onClick={() => setMetric('alpha')}
              aria-selected={metric === 'alpha'}
              style={{ padding: '5px 12px', fontFamily: 'var(--fa-font-mono)', fontSize: 11, letterSpacing: '0.05em', background: metric === 'alpha' ? 'var(--fa-bg-card)' : 'transparent', color: metric === 'alpha' ? 'var(--fa-gold)' : 'var(--fa-text-secondary)', border: 'none', borderRadius: 5, cursor: 'pointer' }}
            >
              Alpha
            </button>
            <button
              onClick={() => setMetric('brier')}
              aria-selected={metric === 'brier'}
              style={{ padding: '5px 12px', fontFamily: 'var(--fa-font-mono)', fontSize: 11, letterSpacing: '0.05em', background: metric === 'brier' ? 'var(--fa-bg-card)' : 'transparent', color: metric === 'brier' ? 'var(--fa-gold)' : 'var(--fa-text-secondary)', border: 'none', borderRadius: 5, cursor: 'pointer' }}
            >
              Brier
            </button>
          </div>
        </div>
        <div style={{ background: 'var(--fa-bg-card)', border: '1px solid var(--fa-border-soft)', borderRadius: 14, padding: 24 }}>
          <TimeSeriesChart agents={top5ChartAgents} metric={metric} />
        </div>
      </section>

      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', flexWrap: 'wrap', marginBottom: 'var(--space-lg)' }}>
        <TimeFilter value={period} onChange={setPeriod} />
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--fa-text-secondary)', cursor: 'pointer', userSelect: 'none' }}>
          <input
            type="checkbox"
            className="lb-checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          Show registered-but-inactive agents
          {inactiveAgents.length > 0 && (
            <span style={{ color: 'var(--fa-text-tertiary)' }}>({inactiveAgents.length})</span>
          )}
        </label>
      </div>

      {entries.length === 0 ? (
        <p>No agents found for this period.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="lb-table">
            <thead>
              <tr>
                <th title={`Ranked by shrunken alpha: (n / (n + ${SHRINKAGE_KAPPA})) · avgAlpha. Pulls agents with few markets toward 0 so a high alpha on a tiny sample doesn't outrank a battle-tested smaller edge. κ=${SHRINKAGE_KAPPA} matches the paper's recommended sample size.`} style={{ whiteSpace: 'nowrap' }}>Rank ⓘ</th>
                <th>Agent</th>
                <th title="Mean per-market α (Brier reduction vs Polymarket benchmark) ± 95% CI. Bottom curve is the kernel density of per-market α — red on the negative side, green on the positive.">Avg Alpha (95% CI) ⓘ</th>
                <th title="Rounds scored / markets scored">Scored</th>
                <th>Last Active</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, idx) => {
                const isBenchmark = isBenchmarkAgent(entry.address);
                const hasScore = entry.scoredMarkets > 0;
                const lower = entry.avgAlphaPct - entry.alphaCIHalfPct;
                const upper = entry.avgAlphaPct + entry.alphaCIHalfPct;
                const crossesZero = lower < 0 && upper > 0;
                const alphaColor = !hasScore || crossesZero
                  ? 'var(--fa-text-primary)'
                  : (entry.avgAlphaPct >= 0 ? 'var(--fa-success)' : 'var(--fa-danger)');
                const rank = idx + 1;
                return (
                  <tr key={entry.address}>
                    {/* Rank */}
                    <td style={{ width: 64 }}>
                      {hasScore ? (
                        <span style={{ fontFamily: 'var(--fa-font-display)', fontWeight: 400, fontVariationSettings: '"opsz" 144, "SOFT" 30', fontSize: 24, lineHeight: 1, letterSpacing: '-0.01em', color: rank <= 3 ? 'var(--fa-gold)' : 'var(--fa-text-tertiary)' }}>
                          {rank <= 9 ? String(rank).padStart(2, '0') : String(rank)}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--fa-text-tertiary)', fontSize: 18 }}>--</span>
                      )}
                    </td>

                    {/* Agent */}
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <Link to={`/agent/${entry.address}`} className="lb-name-link">
                            {entry.name || truncAddr(entry.address)}
                          </Link>
                          {entry.url && (
                            <a href={entry.url} target="_blank" rel="noopener noreferrer" className="lb-ext-link" title="Agent website">↗</a>
                          )}
                          {isBenchmark && (
                            <span style={{ fontFamily: 'var(--fa-font-mono)', fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.1em', padding: '2px 6px', borderRadius: 4, background: 'var(--fa-gold-bg)', color: 'var(--fa-gold)', border: '1px solid rgba(232,177,74,0.3)' }}>Bench</span>
                          )}
                          {entry.provisional && (
                            <span style={{ fontFamily: 'var(--fa-font-mono)', fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.1em', padding: '2px 6px', borderRadius: 4, background: 'transparent', color: 'var(--fa-text-tertiary)', border: '1px solid var(--fa-border-soft)' }} title={`Fewer than ${SHRINKAGE_KAPPA} scored markets — ranking is provisional`}>Prov</span>
                          )}
                        </div>
                        {entry.name && (
                          <a href={`https://polygonscan.com/address/${entry.address}`} target="_blank" rel="noopener noreferrer" className="lb-addr-link">
                            {truncAddr(entry.address)}
                          </a>
                        )}
                      </div>
                    </td>

                    {/* Alpha */}
                    <td style={{ minWidth: 180 }}>
                      {hasScore ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                          <div style={{ display: 'flex', alignItems: 'baseline' }}>
                            <span style={{ fontFamily: 'var(--fa-font-mono)', fontSize: 14, fontWeight: 500, fontVariantNumeric: 'tabular-nums', color: alphaColor }}>
                              {(entry.avgAlphaPct >= 0 ? '+' : '−') + Math.abs(entry.avgAlphaPct).toFixed(2) + '%'}
                            </span>
                            <span style={{ fontFamily: 'var(--fa-font-mono)', fontSize: 12.5, color: 'var(--fa-text-tertiary)', marginLeft: 6 }}>
                              ± {entry.alphaCIHalfPct.toFixed(2)}%
                            </span>
                          </div>
                          <MiniAlphaDist deltas={entry.deltasPct} mean={entry.avgAlphaPct} range={globalMaxAbs} />
                          <div style={{ fontFamily: 'var(--fa-font-mono)', fontSize: 11, color: 'var(--fa-text-tertiary)' }} title={`Shrunken alpha: (n / (n + ${SHRINKAGE_KAPPA})) · avgAlpha`}>
                            rank score:{' '}
                            <span style={{ color: entry.alphaShrunkPct >= 0 ? 'var(--fa-success)' : 'var(--fa-danger)', opacity: 0.7 }}>
                              {(entry.alphaShrunkPct >= 0 ? '+' : '−') + Math.abs(entry.alphaShrunkPct).toFixed(2) + '%'}
                            </span>
                          </div>
                        </div>
                      ) : <span style={{ color: 'var(--fa-text-tertiary)' }}>—</span>}
                    </td>

                    {/* Scored */}
                    <td title={hasScore ? `${entry.scoredMarkets} markets across ${entry.scoredRounds} rounds` : ''} style={{ fontFamily: 'var(--fa-font-mono)', fontSize: 13, color: 'var(--fa-text-secondary)' }}>
                      {hasScore ? `${entry.scoredRounds}r / ${entry.scoredMarkets}m` : '—'}
                    </td>

                    {/* Last Active */}
                    <td style={{ fontFamily: 'var(--fa-font-mono)', fontSize: 12.5, color: 'var(--fa-text-tertiary)', whiteSpace: 'nowrap' }}>
                      {formatRelativeTime(entry.lastActive)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {showInactive && inactiveAgents.length > 0 && (
              <tbody>
                <tr>
                  <td colSpan={5} style={{ paddingTop: 16, paddingBottom: 8, fontFamily: 'var(--fa-font-mono)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--fa-text-tertiary)', borderTop: '1px solid var(--fa-border)' }}>
                    Registered via relayer — no on-chain activity yet ({inactiveAgents.length})
                  </td>
                </tr>
                {inactiveAgents.map((agent) => (
                  <tr key={`inactive-${agent.address}`} style={{ opacity: 0.6 }}>
                    <td><span style={{ color: 'var(--fa-text-tertiary)' }}>—</span></td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <Link to={`/agent/${agent.address}`} className="lb-name-link">
                            {agent.name || truncAddr(agent.address)}
                          </Link>
                          {agent.url && (
                            <a href={agent.url} target="_blank" rel="noopener noreferrer" className="lb-ext-link">↗</a>
                          )}
                          <span style={{ fontFamily: 'var(--fa-font-mono)', fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.1em', padding: '2px 6px', borderRadius: 4, background: 'transparent', color: 'var(--fa-text-tertiary)', border: '1px dashed var(--fa-border)', cursor: 'help' }} title="Registered on-chain via relayer; has not committed in any round yet.">
                            Registered
                          </span>
                        </div>
                        {agent.name && (
                          <a href={`https://polygonscan.com/address/${agent.address}`} target="_blank" rel="noopener noreferrer" className="lb-addr-link">
                            {truncAddr(agent.address)}
                          </a>
                        )}
                      </div>
                    </td>
                    <td><span style={{ color: 'var(--fa-text-tertiary)' }}>—</span></td>
                    <td><span style={{ color: 'var(--fa-text-tertiary)' }}>—</span></td>
                    <td style={{ fontFamily: 'var(--fa-font-mono)', fontSize: 12.5, color: 'var(--fa-text-tertiary)' }} title="Date the agent registered on the ERC-8004 Identity Registry">
                      {formatRelativeTime(agent.registeredAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            )}
          </table>
        </div>
      )}
    </div>
  );
}

import React from 'react';

/**
 * Compact gaussian-KDE sparkline for per-market α distribution.
 * Symmetric x-range around 0 (shared across rows for visual comparison).
 * Curve is filled red on the negative side, green on the positive.
 * A rug plot underneath shows individual market deltas.
 */
function MiniAlphaDist({ deltas, mean, range }: { deltas: number[]; mean: number; range: number }) {
  if (deltas.length === 0) return null;

  const W = 160;
  const H = 32;
  const PAD_X = 2;
  const baseY = H - 4;       // leaves room for rug ticks
  const topY = 4;
  const plotW = W - 2 * PAD_X;
  const plotH = baseY - topY;

  const xToSvg = (x: number) => PAD_X + ((x + range) / (2 * range)) * plotW;

  // Gaussian KDE with Silverman bandwidth, clamped so very narrow distributions still render
  const n = deltas.length;
  const m = deltas.reduce((s, v) => s + v, 0) / n;
  const variance = n > 1 ? deltas.reduce((s, v) => s + (v - m) ** 2, 0) / (n - 1) : 0;
  const sigma = Math.sqrt(variance);
  const h = Math.max(range * 0.06, 1.06 * sigma * Math.pow(Math.max(n, 2), -1 / 5));
  const norm = 1 / (n * h * Math.sqrt(2 * Math.PI));

  const N_POINTS = 41;            // odd so x = 0 is sampled exactly
  const zeroIdx = (N_POINTS - 1) / 2;
  const xs: number[] = new Array(N_POINTS);
  const densities: number[] = new Array(N_POINTS);
  for (let i = 0; i < N_POINTS; i++) {
    const x = -range + (2 * range) * (i / (N_POINTS - 1));
    xs[i] = x;
    let s = 0;
    for (const xi of deltas) {
      const u = (x - xi) / h;
      s += Math.exp(-0.5 * u * u);
    }
    densities[i] = norm * s;
  }
  const maxD = Math.max(1e-9, ...densities);
  const yToSvg = (d: number) => baseY - (d / maxD) * plotH;

  // Build two filled paths split at x=0 for the bicolor fill
  let negPath = `M ${xToSvg(xs[0])} ${baseY}`;
  for (let i = 0; i <= zeroIdx; i++) negPath += ` L ${xToSvg(xs[i]).toFixed(2)} ${yToSvg(densities[i]).toFixed(2)}`;
  negPath += ` L ${xToSvg(0)} ${baseY} Z`;

  let posPath = `M ${xToSvg(0)} ${baseY}`;
  for (let i = zeroIdx; i < N_POINTS; i++) posPath += ` L ${xToSvg(xs[i]).toFixed(2)} ${yToSvg(densities[i]).toFixed(2)}`;
  posPath += ` L ${xToSvg(xs[N_POINTS - 1])} ${baseY} Z`;

  const meanX = xToSvg(mean);
  const meanColor = mean >= 0 ? '#74C476' : '#E66C5C';

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: '100%', maxWidth: W, height: H, display: 'block' }}
    >
      <title>{`${n} markets, KDE of per-market α (range ±${range.toFixed(1)}%)`}</title>
      {/* Filled KDE curves */}
      <path d={negPath} fill="rgba(230, 108, 92, 0.35)" />
      <path d={posPath} fill="rgba(116, 196, 118, 0.35)" />
      {/* Zero line */}
      <line x1={xToSvg(0)} y1={topY} x2={xToSvg(0)} y2={baseY} stroke="rgba(107, 102, 92, 0.5)" strokeWidth={1} strokeDasharray="2 2" />
      {/* Mean marker */}
      <line x1={meanX} y1={topY} x2={meanX} y2={baseY} stroke={meanColor} strokeWidth={1.5} />
      {/* Rug plot: one tick per market delta */}
      {deltas.map((d, i) => (
        <line
          key={i}
          x1={xToSvg(d)}
          y1={baseY}
          x2={xToSvg(d)}
          y2={baseY + 3}
          stroke={d >= 0 ? 'rgba(116, 196, 118, 0.9)' : 'rgba(230, 108, 92, 0.9)'}
          strokeWidth={1}
        />
      ))}
    </svg>
  );
}

const lbCSS = `
  .lb-table { width: 100%; border-collapse: collapse; }
  .lb-table th {
    text-align: left;
    font-family: var(--fa-font-mono); font-size: 10.5px;
    text-transform: uppercase; letter-spacing: 0.12em;
    color: var(--fa-text-tertiary);
    border-bottom: 1px solid var(--fa-border);
    padding: 14px 16px; font-weight: 400;
  }
  .lb-table td { padding: 16px; border-bottom: 1px solid var(--fa-border-soft); vertical-align: middle; }
  .lb-table tbody tr { transition: background 120ms ease; }
  .lb-table tbody tr:hover { background: var(--fa-bg-card-hover) !important; }
  .lb-name-link { color: var(--fa-text-primary); text-decoration: none; font-size: 14.5px; font-weight: 500; font-family: var(--fa-font-body); }
  .lb-name-link:hover { color: var(--fa-gold); }
  .lb-addr-link { font-family: var(--fa-font-mono); font-size: 11.5px; color: var(--fa-text-tertiary); text-decoration: none; }
  .lb-addr-link:hover { color: var(--fa-text-secondary); }
  .lb-ext-link { color: var(--fa-text-tertiary); font-size: 12px; text-decoration: none; }
  .lb-ext-link:hover { color: var(--fa-gold); }
  .lb-checkbox { appearance: none; -webkit-appearance: none; width: 16px; height: 16px; border: 1px solid var(--fa-border); border-radius: 3px; background: var(--fa-bg-base); cursor: pointer; position: relative; flex-shrink: 0; margin: 0; }
  .lb-checkbox:checked { background: var(--fa-gold); border-color: var(--fa-gold); }
  .lb-checkbox:checked::after { content: ''; position: absolute; top: 2px; left: 4px; width: 5px; height: 8px; border: 1.5px solid var(--fa-text-inverse); border-top: none; border-left: none; transform: rotate(45deg); }
`;

const refreshBtnStyle: CSSProperties = {
  background: 'none',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  padding: '4px 10px',
  fontSize: '1rem',
  cursor: 'pointer',
  color: 'var(--text-secondary)',
  transition: 'all 0.15s ease',
};
