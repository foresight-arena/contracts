import { useState, useEffect, useMemo, type CSSProperties, type ReactNode } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useDataContext } from '../context/DataContext';
import { useAgentsMetadata } from '../hooks/useAgentsMetadata';
import LoadingSpinner from '../components/LoadingSpinner';
import { isBenchmarkAgent } from '../config/benchmarks';
import { computeAgentScoring, type MarketSample } from '../lib/scoring';
import TimeSeriesChart from '../components/leaderboard/TimeSeriesChart';

const RELAYER = 'https://api.foresightarena.xyz';

function truncAddr(addr: string): string {
  return '0x' + addr.slice(2, 8) + '…' + addr.slice(-4);
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

export default function AgentDetailPage() {
  const { address: rawAddress } = useParams<{ address: string }>();
  const address = (rawAddress || '').toLowerCase();
  const { rounds, agents: agentMap, loading, refresh } = useDataContext();
  const singleAgentMap = useMemo(() => {
    const m = new Map();
    const info = agentMap.get(address);
    if (info) m.set(address, info);
    return m;
  }, [address, agentMap]);
  const resolvedMeta = useAgentsMetadata(singleAgentMap);

  const [twitter, setTwitter] = useState<{ handle: string; displayName: string; tweetUrl: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [metric, setMetric] = useState<'alpha' | 'brier'>('alpha');

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

  const agentRounds = useMemo(() => {
    return rounds
      .filter(r => r.agents.has(address))
      .sort((a, b) => b.roundId - a.roundId);
  }, [rounds, address]);

  const stats = useMemo(() => {
    const now = Math.floor(Date.now() / 1000);
    let scoredCount = 0, commitCount = 0, nonReveals = 0, scoredMarkets = 0;
    let firstRoundTs = Infinity, lastRoundTs = 0;

    for (const round of agentRounds) {
      const agent = round.agents.get(address);
      if (!agent) continue;
      commitCount++;
      if (!agent.revealed && now >= round.revealDeadline) nonReveals++;
      if (agent.scoredMarkets > 0) {
        scoredCount++;
        scoredMarkets += agent.scoredMarkets;
      }
      firstRoundTs = Math.min(firstRoundTs, round.commitDeadline);
      lastRoundTs = Math.max(lastRoundTs, round.commitDeadline);
    }

    return {
      scoredCount,
      scoredMarkets,
      commitCount,
      nonReveals,
      firstRoundTs: firstRoundTs === Infinity ? 0 : firstRoundTs,
      lastRoundTs,
    };
  }, [agentRounds, address]);

  const { scoring, series } = useMemo(() => {
    const samples: MarketSample[] = [];
    const samplesByRound = new Map<number, MarketSample[]>();

    for (const round of [...agentRounds].sort((a, b) => a.roundId - b.roundId)) {
      const agent = round.agents.get(address);
      if (!agent || !agent.revealed || agent.scoredMarkets === 0) continue;
      const benchmarks = round.benchmarkPrices;
      const preds = agent.predictions;
      for (let i = 0; i < round.conditionIds.length; i++) {
        const outcome = round.outcomes?.[i];
        if (outcome !== 'YES' && outcome !== 'NO') continue;
        if (preds[i] == null || benchmarks[i] == null) continue;
        const sample: MarketSample = {
          p: preds[i] / 10000,
          b: benchmarks[i] / 10000,
          x: outcome === 'YES' ? 1 : 0,
        };
        samples.push(sample);
        const roundSamples = samplesByRound.get(round.roundId) ?? [];
        roundSamples.push(sample);
        samplesByRound.set(round.roundId, roundSamples);
      }
    }

    const scoring = computeAgentScoring(samples);

    const roundSeriesData = Array.from(samplesByRound.entries())
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

    return { scoring, series };
  }, [agentRounds, address]);

  if (loading) return <LoadingSpinner />;

  const handleCopy = () => {
    navigator.clipboard.writeText(rawAddress || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const chartAgent = [{
    address,
    name: agentName || truncAddr(address),
    color: 'var(--fa-chart-1)',
    series,
  }];

  const now = Math.floor(Date.now() / 1000);

  return (
    <div className="page">
      <style>{agentCSS}</style>

      {/* Breadcrumb */}
      <nav style={{ marginBottom: 28 }}>
        <Link to="/leaderboard" className="agent-bc">← Leaderboard</Link>
      </nav>

      {/* Identity strip */}
      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', marginBottom: 36, flexWrap: 'wrap' }}>
        <img
          src={meta?.image || `${RELAYER}/agent/${address}/image`}
          alt="Agent avatar"
          style={{ width: 120, height: 120, borderRadius: 14, border: '1px solid var(--fa-border)', flexShrink: 0, objectFit: 'cover' }}
          onError={(e) => {
            const img = e.currentTarget;
            if (img.src !== `${RELAYER}/agent/${address}/image`) img.src = `${RELAYER}/agent/${address}/image`;
          }}
        />

        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ fontFamily: 'var(--fa-font-display)', fontWeight: 400, fontVariationSettings: '"opsz" 144, "SOFT" 30', fontSize: 'clamp(1.75rem, 3.5vw, 2.25rem)', lineHeight: 1.05, letterSpacing: '-0.02em', margin: '0 0 12px', color: 'var(--fa-text-primary)' }}>
            {agentName || truncAddr(address)}
          </h1>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
            <code style={{ fontFamily: 'var(--fa-font-mono)', fontSize: 12, color: 'var(--fa-text-tertiary)', letterSpacing: '0.02em' }}>
              {rawAddress}
            </code>
            <button onClick={handleCopy} className="agent-copy-btn">
              {copied ? '✓' : 'Copy'}
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {twitter?.handle && (
              <a href={`https://x.com/${twitter.handle}`} target="_blank" rel="noopener noreferrer" className="agent-pill agent-pill-twitter">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0 }}>
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
                @{twitter.handle}
                <span style={{ opacity: 0.55, fontSize: 9.5, letterSpacing: '0.04em' }}>verified</span>
              </a>
            )}
            {info?.agentId != null && (
              <a href={`https://8004scan.io/agents/polygon/${info.agentId}`} target="_blank" rel="noopener noreferrer" className="agent-pill">
                ERC-8004 #{info.agentId}
              </a>
            )}
            {meta?.url && !meta.url.includes('foresightarena.xyz') && (
              <a href={meta.url} target="_blank" rel="noopener noreferrer" className="agent-pill">
                {meta.url.replace(/^https?:\/\//, '')} ↗
              </a>
            )}
            <a href={`https://polygonscan.com/address/${address}`} target="_blank" rel="noopener noreferrer" className="agent-pill">
              Polygonscan ↗
            </a>
          </div>

          {isBenchmark && (
            <div style={{ marginTop: 14, padding: '8px 12px', fontSize: 12.5, color: 'var(--fa-text-secondary)', background: 'rgba(232,177,74,0.06)', border: '1px solid rgba(232,177,74,0.18)', borderRadius: 8, maxWidth: 500, lineHeight: 1.5 }}>
              <strong style={{ color: 'var(--fa-gold)' }}>Benchmark agent</strong> — operated by the platform to produce baseline statistics. Not an independent participant.
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end', flexShrink: 0 }}>
          <button onClick={refresh} style={{ background: 'none', border: '1px solid var(--fa-border)', borderRadius: 6, padding: '4px 10px', fontSize: 15, cursor: 'pointer', color: 'var(--fa-text-secondary)' }} title="Refresh">↻</button>
          {isBenchmark && (
            <span style={{ fontFamily: 'var(--fa-font-mono)', fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.1em', padding: '3px 8px', borderRadius: 4, background: 'var(--fa-gold-bg)', color: 'var(--fa-gold)', border: '1px solid rgba(232,177,74,0.3)' }}>Bench</span>
          )}
          {info?.registrationOrigin === 'RELAYER' && (
            <span style={{ fontFamily: 'var(--fa-font-mono)', fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.1em', padding: '3px 8px', borderRadius: 4, color: 'var(--fa-text-tertiary)', border: '1px solid var(--fa-border-soft)' }} title="Registered via relayer — gas-sponsored onboarding">Gasless</span>
          )}
          {info?.registrationOrigin === 'DIRECT' && (
            <span style={{ fontFamily: 'var(--fa-font-mono)', fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.1em', padding: '3px 8px', borderRadius: 4, color: 'var(--fa-text-tertiary)', border: '1px solid var(--fa-border-soft)' }} title="Registered directly on-chain">Direct</span>
          )}
        </div>
      </div>

      {/* Stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 36 }}>
        <StatCard label="Joined" value={formatDate(info?.registeredAt || 0)} />
        <StatCard label="First Round" value={formatDate(stats.firstRoundTs)} />
        <StatCard label="Last Round" value={formatDate(stats.lastRoundTs)} />
        <StatCard label="Committed" value={`${stats.commitCount} rounds`} />
        <StatCard label="Scored" value={`${stats.scoredCount}r / ${stats.scoredMarkets}m`} />
        <StatCard label="Non-reveals" value={String(stats.nonReveals)} accent={stats.nonReveals > 0} />
      </div>

      {/* Per-agent time series chart */}
      {series.length >= 2 && (
        <section style={{ marginBottom: 36 }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontFamily: 'var(--fa-font-mono)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'var(--fa-gold)', marginBottom: 6 }}>
                Performance over time
              </div>
              <h2 style={{ fontFamily: 'var(--fa-font-display)', fontWeight: 400, fontVariationSettings: '"opsz" 144, "SOFT" 30', fontSize: 'clamp(1.25rem, 2.2vw, 1.5rem)', lineHeight: 1.1, letterSpacing: '-0.02em', margin: 0, color: 'var(--fa-text-primary)' }}>
                {series.length} scored round{series.length !== 1 ? 's' : ''}
              </h2>
            </div>
            <div role="tablist" aria-label="Metric" style={{ display: 'inline-flex', gap: 4, padding: 3, border: '1px solid var(--fa-border-soft)', borderRadius: 8, background: 'var(--fa-bg-base)', flexShrink: 0 }}>
              <button onClick={() => setMetric('alpha')} aria-selected={metric === 'alpha'} style={{ padding: '5px 12px', fontFamily: 'var(--fa-font-mono)', fontSize: 11, letterSpacing: '0.05em', background: metric === 'alpha' ? 'var(--fa-bg-card)' : 'transparent', color: metric === 'alpha' ? 'var(--fa-gold)' : 'var(--fa-text-secondary)', border: 'none', borderRadius: 5, cursor: 'pointer' }}>
                Alpha
              </button>
              <button onClick={() => setMetric('brier')} aria-selected={metric === 'brier'} style={{ padding: '5px 12px', fontFamily: 'var(--fa-font-mono)', fontSize: 11, letterSpacing: '0.05em', background: metric === 'brier' ? 'var(--fa-bg-card)' : 'transparent', color: metric === 'brier' ? 'var(--fa-gold)' : 'var(--fa-text-secondary)', border: 'none', borderRadius: 5, cursor: 'pointer' }}>
                Brier
              </button>
            </div>
          </div>
          <div style={{ background: 'var(--fa-bg-card)', border: '1px solid var(--fa-border-soft)', borderRadius: 14, padding: 24 }}>
            <TimeSeriesChart agents={chartAgent} metric={metric} showLegend={false} />
          </div>
        </section>
      )}

      {/* Murphy decomposition + Alpha anatomy */}
      {scoring.n > 0 && (
        <div style={{ marginBottom: 'var(--space-xl)' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-sm)', marginBottom: 'var(--space-sm)', flexWrap: 'wrap' }}>
            <h2 style={{ marginBottom: 0 }}>Forecasting metrics</h2>
            <a href="https://www.foresightflow.org/publications/foresight-arena" target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.75rem', color: 'var(--accent)' }}>
              method (paper) →
            </a>
          </div>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 'var(--space-md)', lineHeight: 1.6 }}>
            Computed across {scoring.n} resolved markets.
            {scoring.n < 140 && <> <span style={{ color: 'var(--warning)' }}>⚠ Limited data</span> — paper recommends 140+ predictions before drawing conclusions.</>}
          </p>
          {/* Hero: Avg Alpha (large card, full width) */}
          <div style={alphaHeroStyle} title="Mean edge over Polymarket consensus, with 95% confidence interval. Positive = beats the market. The CI shows uncertainty; if it crosses zero, the edge is not yet statistically distinguishable from luck.">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 'var(--space-sm)' }}>
              <span>Avg Alpha (95% CI)</span>
              <span style={{ fontSize: '0.6875rem', cursor: 'help', opacity: 0.7 }}>ⓘ</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-lg)', flexWrap: 'wrap' }}>
              <div style={{ fontSize: '2rem', fontWeight: 700, color: scoring.avgAlpha >= 0 ? '#10b981' : '#ef4444', fontFamily: 'var(--font-mono)' }}>
                {formatPct(scoring.avgAlpha * 100)}
                <span style={{ fontSize: '1.25rem', color: 'var(--text-muted)', fontWeight: 500 }}>
                  {' '}± {formatPct(scoring.alphaSE * 1.96 * 100)}
                </span>
              </div>
              <div style={{ flex: 1, minWidth: 280 }}>
                <AlphaCIBar mean={scoring.avgAlpha * 100} halfWidth={scoring.alphaSE * 1.96 * 100} large />
              </div>
            </div>
            {scoring.deltas.length > 0 && (
              <div style={{ marginTop: 'var(--space-md)' }}>
                <div style={{ fontSize: '0.6875rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 6 }}>
                  Per-market alpha distribution ({scoring.deltas.length} markets)
                </div>
                <AlphaHistogram deltas={scoring.deltas.map(d => d * 100)} mean={scoring.avgAlpha * 100} />
              </div>
            )}
          </div>

          {/* Edge anatomy: how avg α breaks down */}
          <div style={edgeAnatomyStyle}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 'var(--space-sm)' }}>
              <span style={{ fontSize: '0.6875rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>Edge anatomy</span>
              <span style={{ fontSize: '0.625rem', color: 'var(--text-muted)' }} title="Corollary 1 in the paper: α decomposes into how much sharper your sorting is (resolution gain) plus how much better-calibrated you are (reliability gap).">α = (RES_agent − RES_base) + (REL_base − REL_agent) ⓘ</span>
            </div>
            <EdgeAnatomyBars
              resolutionGainPct={scoring.resolutionGain * 100}
              reliabilityGapPct={scoring.reliabilityGap * 100}
            />
          </div>

          {/* 6 other metrics in 3×2 grid */}
          <div style={metricsGridStyle}>
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

      {/* Round history */}
      <div style={{ marginBottom: 'var(--space-xl)' }}>
        <h2 style={{ fontFamily: 'var(--fa-font-display)', fontWeight: 400, fontVariationSettings: '"opsz" 144, "SOFT" 30', fontSize: 'clamp(1.25rem, 2.2vw, 1.5rem)', letterSpacing: '-0.02em', margin: '0 0 16px', color: 'var(--fa-text-primary)' }}>
          Round History
        </h2>
        {agentRounds.length === 0 ? (
          <p style={{ color: 'var(--fa-text-tertiary)', fontFamily: 'var(--fa-font-mono)', fontSize: 13 }}>No rounds yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="agent-rh-table">
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
                  const alphaPct = (agent.alphaScore / 1e8) * 100;
                  const positive = alphaPct >= 0;
                  const revealPill = agent.revealed
                    ? <span className="agent-rh-pill agent-rh-revealed">Revealed</span>
                    : (now >= round.revealDeadline
                        ? <span className="agent-rh-pill agent-rh-missed">Missed</span>
                        : <span className="agent-rh-pill agent-rh-pending">Pending</span>);
                  return (
                    <tr key={round.roundId}>
                      <td>
                        <Link to={`/round/${round.roundId}`} style={{ fontFamily: 'var(--fa-font-display)', fontWeight: 400, fontVariationSettings: '"opsz" 144, "SOFT" 30', fontSize: 20, letterSpacing: '-0.01em', color: 'var(--fa-text-primary)', textDecoration: 'none' }}>
                          #{round.roundId}
                        </Link>
                      </td>
                      <td style={{ fontFamily: 'var(--fa-font-mono)', fontSize: 12, color: 'var(--fa-text-tertiary)', whiteSpace: 'nowrap' }}>
                        {formatRelativeTime(agent.commitTimestamp)}
                      </td>
                      <td>{revealPill}</td>
                      <td style={{ fontFamily: 'var(--fa-font-mono)', fontSize: 13, fontVariantNumeric: 'tabular-nums', color: hasScore ? (positive ? 'var(--fa-success)' : 'var(--fa-danger)') : 'var(--fa-text-tertiary)' }}>
                        {hasScore ? (positive ? '+' : '−') + Math.abs(alphaPct).toFixed(2) + '%' : '—'}
                      </td>
                      <td style={{ fontFamily: 'var(--fa-font-mono)', fontSize: 13, color: 'var(--fa-text-secondary)' }}>
                        {hasScore ? `${agent.scoredMarkets}/${agent.totalMarkets}` : '—'}
                      </td>
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
    <div style={{ backgroundColor: 'var(--fa-bg-card)', border: '1px solid var(--fa-border-soft)', borderRadius: 12, padding: '16px 20px' }} title={tooltip}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'var(--fa-font-mono)', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--fa-text-tertiary)', marginBottom: 8 }}>
        <span>{label}</span>
        {tooltip && <span style={{ cursor: 'help', opacity: 0.6 }}>ⓘ</span>}
      </div>
      <div style={{ fontFamily: 'var(--fa-font-mono)', fontSize: 20, fontWeight: 500, color: accent ? 'var(--fa-danger)' : 'var(--fa-text-primary)', lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {children}
    </div>
  );
}

function AlphaCIBar({ mean, halfWidth, large = false }: { mean: number; halfWidth: number; large?: boolean }) {
  const lower = mean - halfWidth;
  const upper = mean + halfWidth;
  const crossesZero = lower < 0 && upper > 0;

  const maxAbs = Math.max(Math.abs(lower), Math.abs(upper), 1);
  const range = maxAbs * 1.2;
  const W = large ? 480 : 220;
  const H = large ? 64 : 36;
  const midY = H / 2;
  const xScale = (v: number) => W / 2 + (v / range) * (W / 2);

  const ciColor = crossesZero
    ? 'var(--text-muted)'
    : (mean > 0 ? '#10b981' : '#ef4444');

  const labelSize = large ? 11 : 8;
  const tickHalf = large ? 14 : 8;
  const barHalf = large ? 8 : 4;
  const dotR = large ? 6 : 3.5;
  const whiskerHalf = large ? 11 : 6;

  return (
    <div style={{ marginTop: large ? 0 : 8 }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: W, height: 'auto', display: 'block' }}>
        <line x1={0} y1={midY} x2={W} y2={midY} stroke="var(--border)" strokeWidth={1} />
        <text x={2} y={H - 4} fontSize={labelSize} fill="var(--text-muted)">{(-range).toFixed(1)}%</text>
        <text x={W - 2} y={H - 4} fontSize={labelSize} fill="var(--text-muted)" textAnchor="end">+{range.toFixed(1)}%</text>
        <line x1={W / 2} y1={midY - tickHalf} x2={W / 2} y2={midY + tickHalf} stroke="var(--text-muted)" strokeWidth={1} />
        <text x={W / 2} y={large ? 14 : 10} fontSize={labelSize} fill="var(--text-muted)" textAnchor="middle">0</text>
        <rect
          x={xScale(lower)}
          y={midY - barHalf}
          width={Math.max(2, xScale(upper) - xScale(lower))}
          height={barHalf * 2}
          fill={ciColor}
          opacity={0.35}
          rx={2}
        />
        <line x1={xScale(lower)} y1={midY - whiskerHalf} x2={xScale(lower)} y2={midY + whiskerHalf} stroke={ciColor} strokeWidth={large ? 2 : 1.5} />
        <line x1={xScale(upper)} y1={midY - whiskerHalf} x2={xScale(upper)} y2={midY + whiskerHalf} stroke={ciColor} strokeWidth={large ? 2 : 1.5} />
        <circle cx={xScale(mean)} cy={midY} r={dotR} fill={ciColor} />
      </svg>
      {crossesZero && (
        <div style={{ fontSize: large ? '0.75rem' : '0.625rem', color: 'var(--text-muted)', marginTop: 4 }}>
          CI crosses zero — edge not statistically detected
        </div>
      )}
    </div>
  );
}

function AlphaHistogram({ deltas, mean }: { deltas: number[]; mean: number }) {
  if (deltas.length === 0) return null;

  const maxAbs = Math.max(1, ...deltas.map(Math.abs), Math.abs(mean));
  const range = maxAbs * 1.05;

  const binCount = Math.max(8, Math.min(30, Math.round(Math.sqrt(deltas.length) * 2)));
  const binWidth = (2 * range) / binCount;
  const bins = new Array(binCount).fill(0);
  for (const d of deltas) {
    let k = Math.floor((d + range) / binWidth);
    if (k < 0) k = 0;
    if (k >= binCount) k = binCount - 1;
    bins[k]++;
  }
  const maxCount = Math.max(1, ...bins);

  const W = 480, H = 140, PAD_L = 28, PAD_R = 8, PAD_T = 8, PAD_B = 22;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const xScale = (v: number) => PAD_L + ((v + range) / (2 * range)) * plotW;
  const yScale = (count: number) => PAD_T + plotH - (count / maxCount) * plotH;
  const barPlotW = plotW / binCount;
  const zeroX = xScale(0);
  const meanX = xScale(mean);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: W, height: 'auto', display: 'block' }}>
      <text x={PAD_L - 4} y={PAD_T + 8} fontSize={9} fill="var(--text-muted)" textAnchor="end">{maxCount}</text>
      <text x={PAD_L - 4} y={H - PAD_B + 4} fontSize={9} fill="var(--text-muted)" textAnchor="end">0</text>
      <line x1={PAD_L} y1={H - PAD_B} x2={W - PAD_R} y2={H - PAD_B} stroke="var(--border)" strokeWidth={1} />
      {bins.map((count, i) => {
        if (count === 0) return null;
        const binCenter = -range + binWidth * (i + 0.5);
        const x = PAD_L + i * barPlotW;
        const y = yScale(count);
        const h = (H - PAD_B) - y;
        const color = binCenter >= 0 ? '#10b981' : '#ef4444';
        return (
          <rect key={i} x={x + 1} y={y} width={Math.max(1, barPlotW - 2)} height={h} fill={color} opacity={0.55} rx={1}>
            <title>{`α ∈ [${(binCenter - binWidth / 2).toFixed(2)}%, ${(binCenter + binWidth / 2).toFixed(2)}%]: ${count} markets`}</title>
          </rect>
        );
      })}
      <line x1={zeroX} y1={PAD_T} x2={zeroX} y2={H - PAD_B} stroke="var(--text-muted)" strokeWidth={1} strokeDasharray="2 3" />
      <text x={zeroX} y={H - 6} fontSize={9} fill="var(--text-muted)" textAnchor="middle">0</text>
      <line x1={meanX} y1={PAD_T} x2={meanX} y2={H - PAD_B} stroke={mean >= 0 ? '#10b981' : '#ef4444'} strokeWidth={1.5} />
      <text x={meanX} y={PAD_T + 8} fontSize={9} fill={mean >= 0 ? '#10b981' : '#ef4444'} textAnchor={meanX > W / 2 ? 'end' : 'start'} dx={meanX > W / 2 ? -3 : 3}>
        mean {mean >= 0 ? '+' : ''}{mean.toFixed(2)}%
      </text>
      <text x={PAD_L} y={H - 6} fontSize={9} fill="var(--text-muted)">{(-range).toFixed(1)}%</text>
      <text x={W - PAD_R} y={H - 6} fontSize={9} fill="var(--text-muted)" textAnchor="end">+{range.toFixed(1)}%</text>
    </svg>
  );
}

function EdgeAnatomyBars({ resolutionGainPct, reliabilityGapPct }: { resolutionGainPct: number; reliabilityGapPct: number }) {
  const items = [
    { label: 'Resolution gain', sub: 'sharper sorting of YES vs NO than the market', value: resolutionGainPct },
    { label: 'Reliability gap', sub: 'better calibration than the market', value: reliabilityGapPct },
  ];
  const maxAbs = Math.max(0.5, Math.abs(resolutionGainPct), Math.abs(reliabilityGapPct));
  const range = maxAbs * 1.15;

  const W = 480, BAR_H = 14, ROW_GAP = 4;
  const ROW_H = BAR_H + ROW_GAP + 16;
  const H = items.length * ROW_H + 12;
  const xToSvg = (v: number) => W / 2 + (v / range) * (W / 2);
  const zeroX = W / 2;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: W, height: 'auto', display: 'block' }}>
      {items.map((it, idx) => {
        const yLabel = idx * ROW_H + 12;
        const yBar = yLabel + 4;
        const color = it.value >= 0 ? '#10b981' : '#ef4444';
        const x0 = it.value >= 0 ? zeroX : xToSvg(it.value);
        const w = Math.max(2, Math.abs(xToSvg(it.value) - zeroX));
        return (
          <g key={it.label}>
            <text x={4} y={yLabel} fontSize={11} fill="var(--text-secondary)" fontWeight={600}>{it.label}</text>
            <text x={4 + 120} y={yLabel} fontSize={10} fill="var(--text-muted)">— {it.sub}</text>
            <text x={W - 4} y={yLabel} fontSize={11} fill={color} textAnchor="end" fontWeight={700} style={{ fontFamily: 'var(--font-mono)' }}>
              {(it.value >= 0 ? '+' : '') + it.value.toFixed(2) + '%'}
            </text>
            <line x1={0} y1={yBar + BAR_H / 2} x2={W} y2={yBar + BAR_H / 2} stroke="var(--border)" strokeWidth={1} />
            <rect x={x0} y={yBar} width={w} height={BAR_H} fill={color} opacity={0.5} rx={2} />
            <line x1={zeroX} y1={yBar - 2} x2={zeroX} y2={yBar + BAR_H + 2} stroke="var(--text-muted)" strokeWidth={1} />
          </g>
        );
      })}
      <text x={4} y={H - 2} fontSize={9} fill="var(--text-muted)">{(-range).toFixed(1)}%</text>
      <text x={zeroX} y={H - 2} fontSize={9} fill="var(--text-muted)" textAnchor="middle">0</text>
      <text x={W - 4} y={H - 2} fontSize={9} fill="var(--text-muted)" textAnchor="end">+{range.toFixed(1)}%</text>
    </svg>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const metricsGridStyle: CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: 'var(--space-sm)',
};

const alphaHeroStyle: CSSProperties = {
  backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)', padding: 'var(--space-lg)',
  marginBottom: 'var(--space-sm)',
};

const edgeAnatomyStyle: CSSProperties = {
  backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)', padding: 'var(--space-md)',
  marginBottom: 'var(--space-sm)',
};

const agentCSS = `
  .agent-bc {
    font-family: var(--fa-font-mono); font-size: 12px; letter-spacing: 0.04em;
    color: var(--fa-text-tertiary); text-decoration: none;
    transition: color 120ms ease;
  }
  .agent-bc:hover { color: var(--fa-text-secondary); }

  .agent-copy-btn {
    background: none; border: 1px solid var(--fa-border); border-radius: 4px;
    padding: 2px 8px; font-family: var(--fa-font-mono); font-size: 10px;
    color: var(--fa-text-tertiary); cursor: pointer;
    transition: color 120ms ease, border-color 120ms ease;
  }
  .agent-copy-btn:hover { color: var(--fa-text-secondary); border-color: var(--fa-border-strong); }

  .agent-pill {
    display: inline-flex; align-items: center; gap: 5px;
    padding: 4px 10px; border-radius: 999px;
    font-family: var(--fa-font-mono); font-size: 11.5px;
    color: var(--fa-text-tertiary); border: 1px solid var(--fa-border-soft);
    text-decoration: none; transition: color 120ms ease, border-color 120ms ease;
  }
  .agent-pill:hover { color: var(--fa-text-secondary); border-color: var(--fa-border); }
  .agent-pill-twitter { color: var(--fa-text-secondary); }
  .agent-pill-twitter:hover { color: var(--fa-text-primary); border-color: var(--fa-border); }

  .agent-rh-table { width: 100%; border-collapse: collapse; }
  .agent-rh-table th {
    text-align: left; font-family: var(--fa-font-mono); font-size: 10.5px;
    text-transform: uppercase; letter-spacing: 0.12em;
    color: var(--fa-text-tertiary); border-bottom: 1px solid var(--fa-border);
    padding: 14px 16px; font-weight: 400;
  }
  .agent-rh-table td { padding: 14px 16px; border-bottom: 1px solid var(--fa-border-soft); vertical-align: middle; }
  .agent-rh-table tbody tr { transition: background 120ms ease; }
  .agent-rh-table tbody tr:hover { background: var(--fa-bg-card-hover); }

  .agent-rh-pill {
    display: inline-flex; align-items: center; padding: 3px 9px;
    border-radius: 999px; font-family: var(--fa-font-mono); font-size: 10.5px;
    letter-spacing: 0.06em; text-transform: uppercase; font-weight: 500;
  }
  .agent-rh-revealed { background: var(--fa-success-bg); color: var(--fa-success); border: 1px solid rgba(116,196,118,0.3); }
  .agent-rh-missed   { background: var(--fa-danger-bg);  color: var(--fa-danger);  border: 1px solid rgba(230,108,92,0.3); }
  .agent-rh-pending  { background: transparent; color: var(--fa-text-tertiary); border: 1px solid var(--fa-border-soft); }
`;
