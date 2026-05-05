import { useState, useEffect, useMemo, type CSSProperties, type ReactNode } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useDataContext } from '../context/DataContext';
import { useAgentsMetadata } from '../hooks/useAgentsMetadata';
import LoadingSpinner from '../components/LoadingSpinner';
import TimeFilter from '../components/TimeFilter';
import type { TimePeriod } from '../types';
import { isBenchmarkAgent } from '../config/benchmarks';
import { computeAgentScoring, type MarketSample } from '../lib/scoring';

const RELAYER = 'https://api.foresightarena.xyz';

function truncAddr(addr: string): string {
  return addr.slice(0, 6) + '...' + addr.slice(-4);
}

function formatAlpha(score: number): string {
  return ((score / 1e8) * 100).toFixed(2) + '%';
}

function formatPct(value: number): string {
  return value.toFixed(2) + '%';
}

function formatSigned(value: number): string {
  return (value >= 0 ? '+' : '') + value.toFixed(2) + '%';
}

function formatDate(ts: number): string {
  if (!ts) return '--';
  return new Date(ts * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatTs(ts: number): string {
  if (!ts) return '--';
  return new Date(ts * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function AgentDetailPage() {
  const { address: rawAddress } = useParams<{ address: string }>();
  const address = (rawAddress || '').toLowerCase();
  const { rounds, agents: agentMap, loading, refresh } = useDataContext();
  // Only resolve metadata for THIS agent
  const singleAgentMap = useMemo(() => {
    const m = new Map();
    const info = agentMap.get(address);
    if (info) m.set(address, info);
    return m;
  }, [address, agentMap]);
  const resolvedMeta = useAgentsMetadata(singleAgentMap);

  const [twitter, setTwitter] = useState<{ handle: string; displayName: string; tweetUrl: string } | null>(null);
  const [period, setPeriod] = useState<TimePeriod>('30d');
  const [copied, setCopied] = useState(false);

  // Fetch Twitter handle
  useEffect(() => {
    if (!address) return;
    fetch(`${RELAYER}/agent/${address}/twitter`)
      .then(r => r.ok ? r.json() : null)
      .then(d => setTwitter(d))
      .catch(() => {});
  }, [address]);

  const info = agentMap.get(address);
  const meta = resolvedMeta.get(address);
  const agentName = meta?.name || info?.name || '';
  const isBenchmark = isBenchmarkAgent(address);

  // All rounds this agent participated in
  const agentRounds = useMemo(() => {
    return rounds
      .filter(r => r.agents.has(address))
      .sort((a, b) => b.roundId - a.roundId);
  }, [rounds, address]);

  // Filtered by period
  const filteredRounds = useMemo(() => {
    const now = Math.floor(Date.now() / 1000);
    if (period === '7d') return agentRounds.filter(r => r.commitDeadline >= now - 7 * 86400);
    if (period === '30d') return agentRounds.filter(r => r.commitDeadline >= now - 30 * 86400);
    return agentRounds;
  }, [agentRounds, period]);

  // Stats
  const stats = useMemo(() => {
    const now = Math.floor(Date.now() / 1000);
    let totalAlpha = 0, scoredCount = 0, commitCount = 0, nonReveals = 0;
    let scoredMarkets = 0;
    let firstRoundTs = Infinity, lastRoundTs = 0;

    for (const round of agentRounds) {
      const agent = round.agents.get(address);
      if (!agent) continue;
      commitCount++;
      // Only count as non-reveal if reveal deadline has actually passed
      if (!agent.revealed && now >= round.revealDeadline) nonReveals++;
      if (agent.scoredMarkets > 0) {
        totalAlpha += agent.alphaScore;
        scoredCount++;
        scoredMarkets += agent.scoredMarkets;
      }
      firstRoundTs = Math.min(firstRoundTs, round.commitDeadline);
      lastRoundTs = Math.max(lastRoundTs, round.commitDeadline);
    }

    return {
      totalAlpha,
      scoredCount,
      scoredMarkets,
      commitCount,
      nonReveals,
      avgAlpha: scoredCount > 0 ? totalAlpha / scoredCount : 0,
      firstRoundTs: firstRoundTs === Infinity ? 0 : firstRoundTs,
      lastRoundTs,
    };
  }, [agentRounds, address]);

  // Per-market samples for Murphy decomposition (skip VOID and unscored markets)
  const scoring = useMemo(() => {
    const samples: MarketSample[] = [];
    for (const round of agentRounds) {
      const agent = round.agents.get(address);
      if (!agent || !agent.revealed || agent.scoredMarkets === 0) continue;
      const benchmarks = round.benchmarkPrices;
      const preds = agent.predictions;
      for (let i = 0; i < round.conditionIds.length; i++) {
        const outcome = round.outcomes?.[i];
        if (outcome !== 'YES' && outcome !== 'NO') continue;
        if (preds[i] == null || benchmarks[i] == null) continue;
        samples.push({
          p: preds[i] / 10000,
          b: benchmarks[i] / 10000,
          x: outcome === 'YES' ? 1 : 0,
        });
      }
    }
    return computeAgentScoring(samples);
  }, [agentRounds, address]);

  // Chart data
  const chartData = useMemo(() => {
    return filteredRounds
      .filter(r => {
        const a = r.agents.get(address);
        return a && a.scoredMarkets > 0;
      })
      .map(r => {
        const a = r.agents.get(address)!;
        return { roundId: r.roundId, alpha: a.alphaScore / 1e8 * 100 };
      })
      .sort((a, b) => a.roundId - b.roundId);
  }, [filteredRounds, address]);

  if (loading) return <LoadingSpinner />;

  const handleCopy = () => {
    navigator.clipboard.writeText(rawAddress || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="page">
      <div style={{ marginBottom: 'var(--space-md)' }}>
        <Link to="/leaderboard" style={{ fontSize: '0.875rem' }}>&larr; Back to Leaderboard</Link>
      </div>

      {/* Header */}
      <div style={headerStyle}>
        {info?.agentURI && !meta ? (
          <div style={{ ...avatarStyle, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-muted)', fontSize: '3rem', fontWeight: 700 }}>?</div>
        ) : (
          <img
            src={meta?.image || `${RELAYER}/agent/${address}/image`}
            alt="Agent"
            style={avatarStyle}
            onError={(e) => {
              // Fallback to dynamic SVG if NFT image fails to load
              const img = e.currentTarget;
              if (img.src !== `${RELAYER}/agent/${address}/image`) {
                img.src = `${RELAYER}/agent/${address}/image`;
              }
            }}
          />
        )}
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
            <h1 style={{ marginBottom: 0, fontSize: '1.5rem' }}>
              {agentName || truncAddr(address)}
            </h1>
            {isBenchmark && <span className="badge benchmark">benchmark</span>}
            <button onClick={refresh} style={refreshBtnStyle} title="Refresh">&#8635;</button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginTop: 'var(--space-xs)', flexWrap: 'wrap' }}>
            <code style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{rawAddress}</code>
            <button onClick={handleCopy} style={copyBtnStyle}>{copied ? 'Copied' : 'Copy'}</button>
            <a href={`https://polygonscan.com/address/${address}`} target="_blank" rel="noopener noreferrer" style={extLinkStyle}>Polygonscan</a>
            {info?.agentId && (
              <a href={`https://8004scan.io/agents/polygon/${info.agentId}`} target="_blank" rel="noopener noreferrer" style={extLinkStyle}>8004scan</a>
            )}
          </div>

          {meta?.url && !meta.url.includes('foresightarena.xyz') && (
            <div style={{ marginTop: 'var(--space-xs)', fontSize: '0.8125rem' }}>
              <a href={meta.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>
                {meta.url}
              </a>
            </div>
          )}

          {isBenchmark && (
            <div style={{
              marginTop: 'var(--space-sm)',
              padding: '8px 12px',
              fontSize: '0.75rem',
              color: 'var(--text-secondary)',
              backgroundColor: 'rgba(245, 158, 11, 0.08)',
              border: '1px solid rgba(245, 158, 11, 0.25)',
              borderRadius: 'var(--radius-sm)',
              maxWidth: 540,
              lineHeight: 1.5,
            }}>
              <strong style={{ color: 'var(--text-primary)' }}>Benchmark agent.</strong> This is a reference agent operated by the platform to produce baseline statistics. It is not an independent participant.
            </div>
          )}

          {twitter?.handle && (
            <div style={{ marginTop: 'var(--space-xs)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="var(--text-secondary)">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
              <a href={`https://x.com/${twitter.handle}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.8125rem', color: 'var(--text-primary)', textDecoration: 'none' }}>
                {twitter.displayName}
              </a>
              <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>@{twitter.handle}</span>
              <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>verified</span>
            </div>
          )}
        </div>
      </div>

      {/* Stats */}
      <div style={statsGridStyle}>
        <StatCard label="Joined" value={formatDate(info?.registeredAt || 0)} />
        <StatCard label="First Round" value={formatDate(stats.firstRoundTs)} />
        <StatCard label="Last Round" value={formatDate(stats.lastRoundTs)} />
        <StatCard label="Committed" value={`${stats.commitCount} rounds`} />
        <StatCard label="Scored" value={`${stats.scoredCount} rounds, ${stats.scoredMarkets} markets`} />
        <StatCard label="Non-reveals" value={String(stats.nonReveals)} accent={stats.nonReveals > 0} />
      </div>

      {/* Murphy decomposition + Alpha anatomy */}
      {scoring.n > 0 && (
        <div style={{ marginBottom: 'var(--space-xl)' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-sm)', marginBottom: 'var(--space-sm)', flexWrap: 'wrap' }}>
            <h2 style={{ marginBottom: 0 }}>Forecasting metrics</h2>
            <a href="https://arxiv.org/abs/2605.00420" target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.75rem', color: 'var(--accent)' }}>
              method (paper) →
            </a>
          </div>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 'var(--space-md)', lineHeight: 1.6 }}>
            Computed across {scoring.n} resolved markets.
            {scoring.n < 140 && <> <span style={{ color: 'var(--warning)' }}>⚠ Limited data</span> — paper recommends 140+ predictions before drawing conclusions.</>}
          </p>
          <div style={statsGridStyle}>
            <StatCard
              label="Avg Alpha (95% CI)"
              value={`${formatPct(scoring.avgAlpha * 100)} ± ${formatPct(scoring.alphaSE * 1.96 * 100)}`}
              tooltip="Mean edge over Polymarket consensus, with 95% confidence interval. Positive = beats the market. The CI shows uncertainty; if it crosses zero, the edge is not yet statistically distinguishable from luck."
            >
              <AlphaCIBar mean={scoring.avgAlpha * 100} halfWidth={scoring.alphaSE * 1.96 * 100} />
            </StatCard>
            <StatCard
              label="Avg Brier"
              value={formatPct(scoring.agent.brier * 100)}
              tooltip="Mean squared error of probability predictions vs binary outcomes (0 = perfect, 25% = random 50/50, 100% = always wrong with full confidence). Lower is better."
            />
            <StatCard
              label="REL (calibration)"
              value={formatPct(scoring.agent.rel * 100)}
              accent={scoring.agent.rel > scoring.baseline.rel}
              tooltip={`Reliability / calibration error: how well stated probabilities match realized frequencies. 0 = perfectly calibrated. Lower is better. Baseline REL: ${formatPct(scoring.baseline.rel * 100)}.`}
            />
            <StatCard
              label="RES (resolution)"
              value={formatPct(scoring.agent.res * 100)}
              tooltip={`Resolution / discriminative power: how much predictions vary by outcome. Higher = sharper sorting of YES vs NO. Baseline RES: ${formatPct(scoring.baseline.res * 100)}.`}
            />
            <StatCard
              label="UNC (irreducible)"
              value={formatPct(scoring.agent.unc * 100)}
              tooltip="Outcome variance ō(1−ō). Property of the question set, common to all forecasters. Maximum 25% at ō=0.5."
            />
            <StatCard
              label="Resolution gain"
              value={formatSigned(scoring.resolutionGain * 100)}
              tooltip="RES_agent − RES_base. Positive means the agent sorts outcomes more sharply than the market — a stronger discriminative signal."
            />
            <StatCard
              label="Reliability gap"
              value={formatSigned(scoring.reliabilityGap * 100)}
              tooltip="REL_base − REL_agent. Positive means the agent is better calibrated than the market (closer alignment between stated probabilities and realized frequencies)."
            />
          </div>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 'var(--space-sm)', lineHeight: 1.6 }}>
            <strong style={{ color: 'var(--text-secondary)' }}>How to read:</strong> <code>Brier = UNC + REL − RES</code>. <code>Alpha = (RES_agent − RES_base) + (REL_base − REL_agent)</code> — an agent beats the market through better resolution, better calibration, or both. Baseline Brier: {formatPct(scoring.baseline.brier * 100)}.
          </p>
        </div>
      )}

      {/* Chart */}
      {chartData.length > 1 && (
        <div style={{ marginBottom: 'var(--space-xl)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-md)' }}>
            <h2 style={{ marginBottom: 0 }}>Alpha Score</h2>
            <TimeFilter value={period} onChange={setPeriod} />
          </div>
          <AlphaChart data={chartData} />
        </div>
      )}

      {/* Round history */}
      <div style={{ marginBottom: 'var(--space-xl)' }}>
        <h2>Round History</h2>
        {agentRounds.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>No rounds yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Round</th>
                  <th>Committed</th>
                  <th>Revealed</th>
                  <th>Alpha</th>
                  <th>Markets</th>
                </tr>
              </thead>
              <tbody>
                {agentRounds.map(round => {
                  const agent = round.agents.get(address)!;
                  const hasScore = agent.scoredMarkets > 0;
                  const now = Math.floor(Date.now() / 1000);
                  const revealStatus = agent.revealed
                    ? <span className="badge success">Yes</span>
                    : (now >= round.revealDeadline
                        ? <span className="badge warning">No</span>
                        : <span className="badge">Pending</span>);
                  return (
                    <tr key={round.roundId}>
                      <td><Link to={`/round/${round.roundId}`} style={{ fontWeight: 600, fontFamily: 'var(--font-mono)', fontSize: '0.8125rem' }}>#{round.roundId}</Link></td>
                      <td style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{formatTs(agent.commitTimestamp)}</td>
                      <td>{revealStatus}</td>
                      <td className="mono">{hasScore ? formatAlpha(agent.alphaScore) : '--'}</td>
                      <td>{hasScore ? `${agent.scoredMarkets}/${agent.totalMarkets}` : '--'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function StatCard({ label, value, accent, tooltip, children }: { label: string; value: string; accent?: boolean; tooltip?: string; children?: ReactNode }) {
  return (
    <div style={statCardStyle} title={tooltip}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.6875rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 4 }}>
        <span>{label}</span>
        {tooltip && <span style={{ fontSize: '0.625rem', color: 'var(--text-muted)', cursor: 'help', opacity: 0.7 }}>ⓘ</span>}
      </div>
      <div style={{ fontSize: '1rem', fontWeight: 700, color: accent ? 'var(--warning)' : 'var(--text-primary)' }}>{value}</div>
      {children}
    </div>
  );
}

/**
 * Small horizontal bar showing the 95% CI of mean alpha.
 * - Centered around zero so positive/negative is visually obvious
 * - The CI bar straddles or sits above/below zero
 * - Mean marker (dot) and tick at zero
 */
function AlphaCIBar({ mean, halfWidth }: { mean: number; halfWidth: number }) {
  const lower = mean - halfWidth;
  const upper = mean + halfWidth;
  const crossesZero = lower < 0 && upper > 0;

  // Symmetric x range so zero is centered
  const maxAbs = Math.max(Math.abs(lower), Math.abs(upper), 1);
  const range = maxAbs * 1.2; // padding
  const W = 220, H = 36, midY = H / 2;
  const xScale = (v: number) => W / 2 + (v / range) * (W / 2);

  const ciColor = crossesZero
    ? 'var(--text-muted)'           // not statistically distinguishable from 0
    : (mean > 0 ? '#10b981' : '#ef4444'); // green if positive, red if negative

  return (
    <div style={{ marginTop: 8 }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: W, height: 'auto', display: 'block' }}>
        {/* Axis line */}
        <line x1={0} y1={midY} x2={W} y2={midY} stroke="var(--border)" strokeWidth={1} />
        {/* Range labels */}
        <text x={2} y={H - 2} fontSize={8} fill="var(--text-muted)">{(-range).toFixed(1)}%</text>
        <text x={W - 2} y={H - 2} fontSize={8} fill="var(--text-muted)" textAnchor="end">+{range.toFixed(1)}%</text>
        {/* Zero tick */}
        <line x1={W / 2} y1={midY - 8} x2={W / 2} y2={midY + 8} stroke="var(--text-muted)" strokeWidth={1} />
        <text x={W / 2} y={10} fontSize={8} fill="var(--text-muted)" textAnchor="middle">0</text>
        {/* CI bar */}
        <rect
          x={xScale(lower)}
          y={midY - 4}
          width={Math.max(2, xScale(upper) - xScale(lower))}
          height={8}
          fill={ciColor}
          opacity={0.35}
          rx={2}
        />
        {/* CI endpoints (whiskers) */}
        <line x1={xScale(lower)} y1={midY - 6} x2={xScale(lower)} y2={midY + 6} stroke={ciColor} strokeWidth={1.5} />
        <line x1={xScale(upper)} y1={midY - 6} x2={xScale(upper)} y2={midY + 6} stroke={ciColor} strokeWidth={1.5} />
        {/* Mean dot */}
        <circle cx={xScale(mean)} cy={midY} r={3.5} fill={ciColor} />
      </svg>
      {crossesZero && (
        <div style={{ fontSize: '0.625rem', color: 'var(--text-muted)', marginTop: 2 }}>
          CI crosses zero — edge not statistically detected
        </div>
      )}
    </div>
  );
}

function AlphaChart({ data }: { data: { roundId: number; alpha: number }[] }) {
  if (data.length === 0) return null;

  const W = 600, H = 160, PAD = 30;
  const plotW = W - PAD * 2, plotH = H - PAD * 2;
  const maxAbs = Math.max(1, ...data.map(d => Math.abs(d.alpha)));
  const yScale = (v: number) => PAD + plotH / 2 - (v / maxAbs) * (plotH / 2);
  const xScale = (i: number) => PAD + (i / Math.max(1, data.length - 1)) * plotW;
  const zeroY = yScale(0);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: W, height: 'auto', display: 'block' }}>
      {/* Zero line */}
      <line x1={PAD} y1={zeroY} x2={W - PAD} y2={zeroY} stroke="var(--border)" strokeWidth={1} />
      {/* Y labels */}
      <text x={PAD - 4} y={PAD + 4} fontSize={9} fill="var(--text-muted)" textAnchor="end">{maxAbs.toFixed(1)}%</text>
      <text x={PAD - 4} y={zeroY + 3} fontSize={9} fill="var(--text-muted)" textAnchor="end">0%</text>
      <text x={PAD - 4} y={H - PAD + 4} fontSize={9} fill="var(--text-muted)" textAnchor="end">-{maxAbs.toFixed(1)}%</text>
      {/* Bars */}
      {data.map((d, i) => {
        const x = xScale(i);
        const barW = Math.max(4, plotW / data.length - 2);
        const barH = Math.abs(d.alpha / maxAbs) * (plotH / 2);
        const y = d.alpha >= 0 ? zeroY - barH : zeroY;
        const color = d.alpha >= 0 ? '#10b981' : '#ef4444';
        return (
          <g key={d.roundId}>
            <rect x={x - barW / 2} y={y} width={barW} height={barH} fill={color} rx={2} opacity={0.8} />
            <title>Round #{d.roundId}: {d.alpha.toFixed(2)}%</title>
            {data.length <= 20 && (
              <text x={x} y={H - 6} fontSize={8} fill="var(--text-muted)" textAnchor="middle">#{d.roundId}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const headerStyle: CSSProperties = {
  display: 'flex', gap: 'var(--space-lg)', alignItems: 'flex-start',
  marginBottom: 'var(--space-xl)', flexWrap: 'wrap',
};

const avatarStyle: CSSProperties = {
  width: 100, height: 100, borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border)', flexShrink: 0,
};

const refreshBtnStyle: CSSProperties = {
  background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
  padding: '4px 10px', fontSize: '1rem', cursor: 'pointer', color: 'var(--text-secondary)',
};

const copyBtnStyle: CSSProperties = {
  background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
  padding: '2px 8px', fontSize: '0.625rem', cursor: 'pointer', color: 'var(--text-muted)',
};

const extLinkStyle: CSSProperties = {
  fontSize: '0.6875rem', color: 'var(--text-muted)', textDecoration: 'none',
  border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '2px 8px',
};

const statsGridStyle: CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
  gap: 'var(--space-sm)', marginBottom: 'var(--space-xl)',
};

const statCardStyle: CSSProperties = {
  backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)', padding: 'var(--space-md)',
};
