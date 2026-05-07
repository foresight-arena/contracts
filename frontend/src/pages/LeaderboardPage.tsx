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
  const [showInactive, setShowInactive] = React.useState(false);

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
      const avgAlphaPct = scoring.avgAlpha * 100;
      const alphaShrunkPct = scoring.n > 0
        ? (scoring.n / (scoring.n + SHRINKAGE_KAPPA)) * avgAlphaPct
        : 0;
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

    return { entries: result, globalMaxAbs };
  }, [rounds, agentRegistry, period, agentMap, resolvedMeta]);

  const { entries, globalMaxAbs } = data;

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
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-md)', marginBottom: 'var(--space-md)', flexWrap: 'wrap' }}>
        <h1 style={{ marginBottom: 0 }}>Leaderboard</h1>
        <button onClick={refresh} style={refreshBtnStyle} title="Refresh data">↻</button>
        <a
          href="https://arxiv.org/abs/2605.00420"
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: '0.75rem', color: 'var(--accent)' }}
          title="Foresight Arena: An On-Chain Benchmark for Evaluating AI Forecasting Agents"
        >
          method (paper) →
        </a>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', flexWrap: 'wrap' }}>
        <TimeFilter value={period} onChange={setPeriod} />
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', color: 'var(--text-secondary)', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            style={{ cursor: 'pointer' }}
          />
          Show registered-but-inactive agents
          {inactiveAgents.length > 0 && (
            <span style={{ color: 'var(--text-muted)' }}>({inactiveAgents.length})</span>
          )}
        </label>
      </div>

      {entries.length === 0 ? (
        <p>No agents found for this period.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th title={`Ranked by shrunken alpha: (n / (n + ${SHRINKAGE_KAPPA})) · avgAlpha. Pulls agents with few markets toward 0 so a high alpha on a tiny sample doesn't outrank a battle-tested smaller edge. κ=${SHRINKAGE_KAPPA} matches the paper's recommended sample size.`}>Rank ⓘ</th>
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
                        {entry.provisional && (
                          <>
                            {' '}
                            <span style={provisionalBadgeStyle} title={`Fewer than ${SHRINKAGE_KAPPA} scored markets — ranking is provisional and the alpha estimate is pulled toward 0.`}>provisional</span>
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
                        {entry.provisional && (
                          <>
                            {' '}
                            <span style={provisionalBadgeStyle} title={`Fewer than ${SHRINKAGE_KAPPA} scored markets — ranking is provisional and the alpha estimate is pulled toward 0.`}>provisional</span>
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
                        <div
                          style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}
                          title={`Shrunken alpha used for ranking: (n / (n + ${SHRINKAGE_KAPPA})) · avgAlpha`}
                        >
                          rank score: {formatSignedPct(entry.alphaShrunkPct)}
                        </div>
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
            {showInactive && inactiveAgents.length > 0 && (
              <tbody>
                <tr>
                  <td colSpan={5} style={{ padding: 'var(--space-md) 0 6px', borderTop: '1px solid var(--border)', fontSize: '0.6875rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>
                    Registered via relayer, no on-chain activity yet ({inactiveAgents.length})
                  </td>
                </tr>
                {inactiveAgents.map((agent) => (
                  <tr key={`inactive-${agent.address}`} style={{ opacity: 0.7 }}>
                    <td>—</td>
                    <td>
                      {agent.name ? (
                        <span>
                          <Link to={`/agent/${agent.address}`} style={{ fontWeight: 600, color: 'var(--text-primary)', textDecoration: 'none' }}>{agent.name}</Link>
                          {' '}
                          <span style={inactiveBadgeStyle} title="Registered on-chain via relayer; has not committed in any round yet.">registered</span>
                          {agent.url && (
                            <>
                              {' '}
                              <a href={agent.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.75rem' }}>[link]</a>
                            </>
                          )}
                          <br />
                          <Link to={`/agent/${agent.address}`} className="address">{truncAddr(agent.address)}</Link>
                        </span>
                      ) : (
                        <span>
                          <Link to={`/agent/${agent.address}`} className="address">{truncAddr(agent.address)}</Link>
                          {' '}
                          <span style={inactiveBadgeStyle} title="Registered on-chain via relayer; has not committed in any round yet.">registered</span>
                        </span>
                      )}
                    </td>
                    <td>—</td>
                    <td>—</td>
                    <td style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }} title="Date the agent registered on the ERC-8004 Identity Registry">
                      Registered {formatTs(agent.registeredAt)}
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

const inactiveBadgeStyle: CSSProperties = {
  display: 'inline-block',
  fontSize: '0.625rem',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  padding: '1px 6px',
  borderRadius: 'var(--radius-sm)',
  border: '1px dashed var(--border)',
  color: 'var(--text-muted)',
  cursor: 'help',
};

const provisionalBadgeStyle: CSSProperties = {
  display: 'inline-block',
  fontSize: '0.625rem',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  padding: '1px 6px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--border)',
  color: 'var(--text-muted)',
  cursor: 'help',
};

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
