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

interface LeaderboardRow {
  address: string;
  name: string;
  url: string;
  avgAlphaPct: number;        // mean δ in %, from per-market computation
  alphaCIHalfPct: number;     // 1.96 * SE in %
  deltasPct: number[];        // per-market δ in %
  scoredMarkets: number;
  scoredRounds: number;
  commitCount: number;
  lastActive: number;
}

function truncAddr(addr: string): string {
  return addr.slice(0, 6) + '...' + addr.slice(-4);
}

function formatSignedPct(v: number): string {
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
}

function formatTs(ts: number): string {
  if (!ts) return '--';
  return new Date(ts * 1000).toLocaleString();
}

export default function LeaderboardPage() {
  const { rounds, agents: agentRegistry, loading, refresh } = useDataContext();
  const [period, setPeriod] = React.useState<TimePeriod>('30d');

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
      { samples: MarketSample[]; scoredRounds: number; commitCount: number; lastActive: number }
    >();

    for (const round of filtered) {
      for (const [addr, agent] of round.agents) {
        const key = addr.toLowerCase();
        const existing = agg.get(key) || { samples: [], scoredRounds: 0, commitCount: 0, lastActive: 0 };
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
            existing.samples.push({
              p: preds[i] / 10000,
              b: benchmarks[i] / 10000,
              x: outcome === 'YES' ? 1 : 0,
            });
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
      result.push({
        address: addr,
        name: meta?.name ?? info?.name ?? '',
        url: meta?.url ?? info?.url ?? '',
        avgAlphaPct: scoring.avgAlpha * 100,
        alphaCIHalfPct: scoring.alphaSE * 1.96 * 100,
        deltasPct: scoring.deltas.map((d) => d * 100),
        scoredMarkets: scoring.n,
        scoredRounds: data.scoredRounds,
        commitCount: data.commitCount,
        lastActive: data.lastActive,
      });
    }

    // Sort by alpha descending; unscored agents go to bottom
    result.sort((a, b) => {
      if (a.scoredMarkets === 0 && b.scoredMarkets === 0) return 0;
      if (a.scoredMarkets === 0) return 1;
      if (b.scoredMarkets === 0) return -1;
      return b.avgAlphaPct - a.avgAlphaPct;
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

    return { entries: result, globalMaxAbs };
  }, [rounds, agentRegistry, period, agentMap, resolvedMeta]);

  const { entries, globalMaxAbs } = data;

  if (loading) return <LoadingSpinner />;

  return (
    <div className="page">
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', marginBottom: 'var(--space-md)' }}>
        <h1 style={{ marginBottom: 0 }}>Leaderboard</h1>
        <button onClick={refresh} style={refreshBtnStyle} title="Refresh data">↻</button>
      </div>

      <TimeFilter value={period} onChange={setPeriod} />

      {entries.length === 0 ? (
        <p>No agents found for this period.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Rank</th>
                <th>Agent</th>
                <th title="Mean per-market α (Brier reduction vs Polymarket benchmark) ± 95% CI. Bottom curve is the kernel density of per-market α — red on the negative side, green on the positive.">Avg Alpha (95% CI)</th>
                <th>Scored</th>
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
                  ? 'var(--text-primary)'
                  : (entry.avgAlphaPct >= 0 ? '#10b981' : '#ef4444');
                return (
                <tr key={entry.address} className={isBenchmark ? 'benchmark-row' : undefined}>
                  <td>{hasScore ? idx + 1 : '--'}</td>
                  <td>
                    {entry.name ? (
                      <span>
                        <Link to={`/agent/${entry.address}`} style={{ fontWeight: 600, color: 'var(--text-primary)', textDecoration: 'none' }}>{entry.name}</Link>
                        {isBenchmark && (
                          <>
                            {' '}
                            <span className="badge benchmark" title="Benchmark agent">benchmark</span>
                          </>
                        )}
                        {entry.url && (
                          <>
                            {' '}
                            <a
                              href={entry.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ fontSize: '0.75rem' }}
                            >
                              [link]
                            </a>
                          </>
                        )}
                        <br />
                        <Link to={`/agent/${entry.address}`} className="address">{truncAddr(entry.address)}</Link>
                      </span>
                    ) : (
                      <span>
                        <Link to={`/agent/${entry.address}`} className="address">{truncAddr(entry.address)}</Link>
                        {isBenchmark && (
                          <>
                            {' '}
                            <span className="badge benchmark" title="Benchmark agent">benchmark</span>
                          </>
                        )}
                      </span>
                    )}
                  </td>
                  <td className="mono" style={{ whiteSpace: 'nowrap', minWidth: 180 }}>
                    {hasScore ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <div>
                          <span style={{ color: alphaColor, fontWeight: 600 }}>{formatSignedPct(entry.avgAlphaPct)}</span>
                          <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> ± {entry.alphaCIHalfPct.toFixed(2)}%</span>
                        </div>
                        <MiniAlphaDist
                          deltas={entry.deltasPct}
                          mean={entry.avgAlphaPct}
                          range={globalMaxAbs}
                        />
                      </div>
                    ) : '--'}
                  </td>
                  <td title={hasScore ? `${entry.scoredMarkets} markets across ${entry.scoredRounds} rounds` : ''}>
                    {hasScore ? `${entry.scoredRounds}r / ${entry.scoredMarkets}m` : '--'}
                  </td>
                  <td style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                    {formatTs(entry.lastActive)}
                  </td>
                </tr>
                );
              })}
            </tbody>
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
  const meanColor = mean >= 0 ? '#10b981' : '#ef4444';

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: '100%', maxWidth: W, height: H, display: 'block' }}
    >
      <title>{`${n} markets, KDE of per-market α (range ±${range.toFixed(1)}%)`}</title>
      {/* Filled KDE curves */}
      <path d={negPath} fill="#ef4444" opacity={0.4} />
      <path d={posPath} fill="#10b981" opacity={0.4} />
      {/* Zero line */}
      <line x1={xToSvg(0)} y1={topY} x2={xToSvg(0)} y2={baseY} stroke="var(--text-muted)" strokeWidth={1} strokeDasharray="2 2" />
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
          stroke={d >= 0 ? '#10b981' : '#ef4444'}
          strokeWidth={1}
          opacity={0.7}
        />
      ))}
    </svg>
  );
}

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
