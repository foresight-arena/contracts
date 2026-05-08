import { useState, useEffect, useMemo, type CSSProperties, type ReactNode } from 'react';
import { useParams, Link } from 'react-router-dom';
import NotFoundPage from './NotFoundPage';
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

function getInitials(name: string): string {
  if (!name) return '··';
  const cleaned = name.replace(/^benchmark-/i, '');
  const parts = cleaned.split(/[-_\s]/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  if (parts.length === 1 && parts[0].length >= 2) return parts[0].slice(0, 2).toUpperCase();
  return '··';
}

const CHART_PALETTE = [
  'var(--fa-chart-1)',
  'var(--fa-chart-2)',
  'var(--fa-chart-3)',
  'var(--fa-chart-4)',
  'var(--fa-chart-5)',
];

function colorForAddress(addr: string): string {
  if (!addr) return CHART_PALETTE[0];
  const a = addr.toLowerCase().replace(/^0x/, '');
  let h = 0;
  for (let i = 0; i < a.length; i++) {
    h = (h * 31 + a.charCodeAt(i)) >>> 0;
  }
  return CHART_PALETTE[h % CHART_PALETTE.length];
}

function formatPct(value: number): string {
  return value.toFixed(2) + '%';
}

function formatSigned(value: number): string {
  return (value >= 0 ? '+' : '−') + Math.abs(value).toFixed(2) + '%';
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
  const [avatarError, setAvatarError] = useState(false);

  useEffect(() => {
    if (!address) return;
    fetch(`${RELAYER}/agent/${address}/twitter`)
      .then(r => r.ok ? r.json() : null)
      .then(d => setTwitter(d))
      .catch(() => {});
  }, [address]);

  useEffect(() => { setAvatarError(false); }, [address, resolvedMeta]);

  const info = agentMap.get(address);
  const meta = resolvedMeta.get(address);
  const agentName = meta?.name || info?.name || '';
  const isBenchmark = isBenchmarkAgent(address);
  const displayName = agentName || truncAddr(address);
  const RELAYER_IMAGE_PATTERN = /^https?:\/\/api\.foresightarena\.xyz\/agent\/[^/]+\/image/i;
  const hasCustomImage =
    !!meta?.image &&
    meta.image.trim() !== '' &&
    !RELAYER_IMAGE_PATTERN.test(meta.image.trim());
  const avatarSrc = hasCustomImage ? meta!.image : null;

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
  if (!info) return <NotFoundPage />;

  const handleCopy = () => {
    navigator.clipboard.writeText(rawAddress || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const chartAgent = [{
    address,
    name: displayName,
    color: 'var(--fa-chart-1)',
    series,
  }];

  const now = Math.floor(Date.now() / 1000);

  const avgAlphaPct = scoring.avgAlpha * 100;
  const alphaPos = avgAlphaPct >= 0;
  const resGainColor = scoring.resolutionGain >= 0 ? 'var(--fa-success)' : 'var(--fa-danger)';
  const relGapColor = scoring.reliabilityGap >= 0 ? 'var(--fa-success)' : 'var(--fa-danger)';

  return (
    <div className="page">
      <style>{agentCSS}</style>

      {/* Breadcrumb */}
      <nav style={{ marginBottom: 28 }}>
        <Link to="/leaderboard" className="agent-bc">← Leaderboard</Link>
      </nav>

      {/* Identity strip */}
      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', marginBottom: 36, flexWrap: 'wrap' }}>
        {/* Avatar */}
        {avatarSrc && !avatarError ? (
          <img
            src={avatarSrc}
            alt={displayName}
            style={{ width: 120, height: 120, borderRadius: 14, objectFit: 'cover', border: '1px solid var(--fa-border-soft)', background: 'var(--fa-bg-card)', flexShrink: 0 }}
            onError={() => setAvatarError(true)}
          />
        ) : (
          <div style={{ width: 120, height: 120, borderRadius: 14, background: 'var(--fa-bg-card)', border: '1px solid var(--fa-border-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--fa-font-display)', fontVariationSettings: '"opsz" 144, "SOFT" 30', fontWeight: 400, fontSize: 44, color: colorForAddress(address), letterSpacing: '-0.02em', userSelect: 'none', flexShrink: 0 }}>
            {getInitials(displayName)}
          </div>
        )}

        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ fontFamily: 'var(--fa-font-display)', fontWeight: 400, fontVariationSettings: '"opsz" 144, "SOFT" 30', fontSize: 'clamp(1.75rem, 3.5vw, 2.25rem)', lineHeight: 1.05, letterSpacing: '-0.02em', margin: '0 0 12px', color: 'var(--fa-text-primary)' }}>
            {displayName}
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
        <div style={{ marginBottom: 48 }}>

          {/* Section header */}
          <header style={{ marginBottom: 20 }}>
            <div style={{ fontFamily: 'var(--fa-font-mono)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'var(--fa-gold)', marginBottom: 8 }}>
              Forecasting metrics
            </div>
            <h2 style={{ fontFamily: 'var(--fa-font-display)', fontWeight: 400, fontVariationSettings: '"opsz" 144, "SOFT" 30', fontSize: 'clamp(1.5rem, 2.6vw, 1.875rem)', lineHeight: 1.05, letterSpacing: '-0.02em', margin: '0 0 12px', color: 'var(--fa-text-primary)', display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
              <span>Computed across {scoring.n} resolved markets</span>
              <a href="https://www.foresightflow.org/publications/foresight-arena" target="_blank" rel="noopener noreferrer" style={{ fontFamily: 'var(--fa-font-body)', fontSize: 13, fontWeight: 400, color: 'var(--fa-gold)', textDecoration: 'none', whiteSpace: 'nowrap' }}>
                method (paper) →
              </a>
            </h2>
            {scoring.n < 140 && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '5px 12px', background: 'var(--fa-gold-bg)', border: '1px solid rgba(232,177,74,0.3)', borderRadius: 999, fontFamily: 'var(--fa-font-mono)', fontSize: 11.5, color: 'var(--fa-gold)' }}>
                <span>⚠</span> Limited data — paper recommends 140+ predictions
              </div>
            )}
          </header>

          {/* Alpha hero card */}
          <div style={{ background: 'var(--fa-bg-card)', border: '1px solid var(--fa-border-soft)', borderRadius: 14, padding: 28, marginBottom: 16 }} title="Mean edge over Polymarket consensus, with 95% confidence interval. Positive = beats the market. The CI shows uncertainty; if it crosses zero, the edge is not yet statistically distinguishable from luck.">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--fa-font-mono)', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--fa-text-tertiary)', marginBottom: 12 }}>
              <span>Avg Alpha (95% CI)</span>
              <span style={{ cursor: 'help', opacity: 0.7 }}>ⓘ</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap', marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 0 }}>
                <span style={{ fontFamily: 'var(--fa-font-mono)', fontSize: 'clamp(2rem, 4vw, 2.5rem)', fontWeight: 500, fontVariantNumeric: 'tabular-nums', lineHeight: 1, letterSpacing: '-0.02em', color: alphaPos ? 'var(--fa-success)' : 'var(--fa-danger)' }}>
                  {(alphaPos ? '' : '−') + Math.abs(avgAlphaPct).toFixed(2) + '%'}
                </span>
                <span style={{ fontFamily: 'var(--fa-font-mono)', fontSize: 'clamp(1rem, 1.8vw, 1.25rem)', color: 'var(--fa-text-tertiary)', marginLeft: 10, fontWeight: 400 }}>
                  ± {formatPct(scoring.alphaSE * 1.96 * 100)}
                </span>
              </div>
              <div style={{ flex: 1, minWidth: 240 }}>
                <AlphaCIBar mean={avgAlphaPct} halfWidth={scoring.alphaSE * 1.96 * 100} large />
              </div>
            </div>
            {scoring.deltas.length > 0 && (
              <div>
                <div style={{ fontFamily: 'var(--fa-font-mono)', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--fa-text-tertiary)', marginBottom: 10 }}>
                  Per-market alpha distribution ({scoring.deltas.length} markets)
                </div>
                <AlphaHistogram deltas={scoring.deltas.map(d => d * 100)} mean={avgAlphaPct} />
              </div>
            )}
          </div>

          {/* Edge anatomy card */}
          <div style={{ background: 'var(--fa-bg-card)', border: '1px solid var(--fa-border-soft)', borderRadius: 14, padding: 28, marginBottom: 16 }}>
            <div style={{ fontFamily: 'var(--fa-font-mono)', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--fa-text-tertiary)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
              <span>Edge anatomy</span>
              <span style={{ color: 'var(--fa-text-secondary)', textTransform: 'none', letterSpacing: 'normal' }} title="Corollary 1 in the paper: α decomposes into how much sharper your sorting is (resolution gain) plus how much better-calibrated you are (reliability gap).">
                α = (RES_agent − RES_base) + (REL_base − REL_agent) ⓘ
              </span>
            </div>
            <EdgeAnatomyBars
              resolutionGainPct={scoring.resolutionGain * 100}
              reliabilityGapPct={scoring.reliabilityGap * 100}
            />
          </div>

          {/* 6 metric cards */}
          <div style={metricsGridStyle}>
            <StatCard
              label="Avg Brier"
              value={formatPct(scoring.agent.brier * 100)}
              tooltip="Mean squared error of probability predictions vs binary outcomes (0 = perfect, 25% = random 50/50, 100% = always wrong with full confidence). Lower is better."
            />
            <StatCard
              label="REL (calibration)"
              value={formatPct(scoring.agent.rel * 100)}
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
              valueColor={resGainColor}
              tooltip="RES_agent − RES_base. Positive means the agent sorts outcomes more sharply than the market — a stronger discriminative signal."
            />
            <StatCard
              label="Reliability gap"
              value={formatSigned(scoring.reliabilityGap * 100)}
              valueColor={relGapColor}
              tooltip="REL_base − REL_agent. Positive means the agent is better calibrated than the market (closer alignment between stated probabilities and realized frequencies)."
            />
          </div>

          {/* Footnote */}
          <div style={{ marginTop: 16, padding: '14px 16px', background: 'var(--fa-bg-card)', border: '1px solid var(--fa-border-soft)', borderRadius: 10, fontFamily: 'var(--fa-font-mono)', fontSize: 11.5, lineHeight: 1.6, color: 'var(--fa-text-secondary)' }}>
            <strong style={{ color: 'var(--fa-text-primary)', fontWeight: 600 }}>How to read:</strong>{' '}
            Brier = UNC + REL − RES. Alpha = (RES_agent − RES_base) + (REL_base − REL_agent) — an agent beats the market through better resolution, better calibration, or both. Baseline Brier: {formatPct(scoring.baseline.brier * 100)}.
          </div>
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

function StatCard({ label, value, accent, valueColor, tooltip, children }: { label: string; value: string; accent?: boolean; valueColor?: string; tooltip?: string; children?: ReactNode }) {
  return (
    <div style={{ backgroundColor: 'var(--fa-bg-card)', border: '1px solid var(--fa-border-soft)', borderRadius: 12, padding: '18px 20px', display: 'flex', flexDirection: 'column', minHeight: 92 }} title={tooltip}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'var(--fa-font-mono)', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--fa-text-tertiary)', marginBottom: 8 }}>
        <span>{label}</span>
        {tooltip && <span style={{ cursor: 'help', opacity: 0.6 }}>ⓘ</span>}
      </div>
      <div style={{ fontFamily: 'var(--fa-font-mono)', fontSize: 22, fontWeight: 500, color: valueColor || (accent ? 'var(--fa-danger)' : 'var(--fa-text-primary)'), lineHeight: 1.1, fontVariantNumeric: 'tabular-nums', marginTop: 'auto' }}>{value}</div>
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

  const ciFill = crossesZero
    ? 'rgba(168,162,148,0.2)'
    : (mean > 0 ? 'rgba(116,196,118,0.4)' : 'rgba(230,108,92,0.4)');
  const ciStroke = crossesZero
    ? 'rgba(168,162,148,0.5)'
    : (mean > 0 ? '#74C476' : '#E66C5C');

  const labelSize = large ? 10.5 : 8;
  const tickHalf = large ? 14 : 8;
  const barHalf = large ? 8 : 4;
  const dotR = large ? 5 : 3.5;
  const whiskerHalf = large ? 11 : 6;

  return (
    <div style={{ marginTop: large ? 0 : 8 }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: W, height: 'auto', display: 'block' }}>
        {/* Axis track */}
        <line x1={0} y1={midY} x2={W} y2={midY} style={{ stroke: 'rgba(168,162,148,0.2)', strokeWidth: 1 }} />
        {/* Domain labels */}
        <text x={2} y={H - 4} fontSize={labelSize} style={{ fill: 'var(--fa-text-tertiary)', fontFamily: 'var(--fa-font-mono)' }}>{(-range).toFixed(1)}%</text>
        <text x={W - 2} y={H - 4} fontSize={labelSize} textAnchor="end" style={{ fill: 'var(--fa-text-tertiary)', fontFamily: 'var(--fa-font-mono)' }}>+{range.toFixed(1)}%</text>
        {/* Zero tick */}
        <line x1={W / 2} y1={midY - tickHalf} x2={W / 2} y2={midY + tickHalf} style={{ stroke: 'var(--fa-text-tertiary)', strokeWidth: 1, strokeDasharray: '2 2' }} />
        <text x={W / 2} y={large ? 14 : 10} fontSize={labelSize} textAnchor="middle" style={{ fill: 'var(--fa-text-tertiary)', fontFamily: 'var(--fa-font-mono)' }}>0</text>
        {/* CI bar */}
        <rect
          x={xScale(lower)}
          y={midY - barHalf}
          width={Math.max(2, xScale(upper) - xScale(lower))}
          height={barHalf * 2}
          fill={ciFill}
          rx={2}
        />
        {/* CI endpoints (whiskers) */}
        <line x1={xScale(lower)} y1={midY - whiskerHalf} x2={xScale(lower)} y2={midY + whiskerHalf} stroke={ciStroke} strokeWidth={large ? 1.5 : 1} />
        <line x1={xScale(upper)} y1={midY - whiskerHalf} x2={xScale(upper)} y2={midY + whiskerHalf} stroke={ciStroke} strokeWidth={large ? 1.5 : 1} />
        {/* Mean dot — always primary */}
        <circle cx={xScale(mean)} cy={midY} r={dotR} style={{ fill: 'var(--fa-text-primary)' }} />
      </svg>
      <div style={{ fontFamily: 'var(--fa-font-mono)', fontSize: large ? 11.5 : 9, color: crossesZero ? 'var(--fa-text-tertiary)' : 'var(--fa-text-secondary)', marginTop: 4 }}>
        {crossesZero ? 'CI crosses zero — edge not statistically detected' : 'Edge statistically detected'}
      </div>
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

  const W = 480, H = 140, PAD_L = 32, PAD_R = 8, PAD_T = 8, PAD_B = 22;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const xScale = (v: number) => PAD_L + ((v + range) / (2 * range)) * plotW;
  const yScale = (count: number) => PAD_T + plotH - (count / maxCount) * plotH;
  const barPlotW = plotW / binCount;
  const zeroX = xScale(0);
  const meanX = xScale(mean);
  const meanColor = mean >= 0 ? '#74C476' : '#E66C5C';

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: W, height: 'auto', display: 'block' }}>
      {/* Y-axis count labels */}
      <text x={PAD_L - 4} y={PAD_T + 8} fontSize={10.5} textAnchor="end" style={{ fill: 'var(--fa-text-tertiary)', fontFamily: 'var(--fa-font-mono)' }}>{maxCount}</text>
      <text x={PAD_L - 4} y={H - PAD_B + 4} fontSize={10.5} textAnchor="end" style={{ fill: 'var(--fa-text-tertiary)', fontFamily: 'var(--fa-font-mono)' }}>0</text>
      {/* Baseline */}
      <line x1={PAD_L} y1={H - PAD_B} x2={W - PAD_R} y2={H - PAD_B} style={{ stroke: 'var(--fa-border-soft)', strokeWidth: 1 }} />
      {/* Bars */}
      {bins.map((count, i) => {
        if (count === 0) return null;
        const binCenter = -range + binWidth * (i + 0.5);
        const x = PAD_L + i * barPlotW;
        const y = yScale(count);
        const h = (H - PAD_B) - y;
        const barFill = binCenter >= 0 ? 'rgba(116,196,118,0.7)' : 'rgba(230,108,92,0.7)';
        return (
          <rect key={i} x={x + 1} y={y} width={Math.max(1, barPlotW - 2)} height={h} fill={barFill} rx={1}>
            <title>{`α ∈ [${(binCenter - binWidth / 2).toFixed(2)}%, ${(binCenter + binWidth / 2).toFixed(2)}%]: ${count} markets`}</title>
          </rect>
        );
      })}
      {/* Zero line */}
      <line x1={zeroX} y1={PAD_T} x2={zeroX} y2={H - PAD_B} style={{ stroke: 'var(--fa-text-tertiary)', strokeWidth: 1, strokeDasharray: '2 3' }} />
      <text x={zeroX} y={H - 6} fontSize={10.5} textAnchor="middle" style={{ fill: 'var(--fa-text-tertiary)', fontFamily: 'var(--fa-font-mono)' }}>0</text>
      {/* Mean line + label */}
      <line x1={meanX} y1={PAD_T} x2={meanX} y2={H - PAD_B} stroke={meanColor} strokeWidth={1.5} />
      <text x={meanX} y={PAD_T + 8} fontSize={10.5} fill={meanColor} textAnchor={meanX > W / 2 ? 'end' : 'start'} dx={meanX > W / 2 ? -3 : 3} style={{ fontFamily: 'var(--fa-font-mono)' }}>
        mean {mean >= 0 ? '+' : '−'}{Math.abs(mean).toFixed(2)}%
      </text>
      {/* X-axis range labels */}
      <text x={PAD_L} y={H - 6} fontSize={10.5} style={{ fill: 'var(--fa-text-tertiary)', fontFamily: 'var(--fa-font-mono)' }}>{(-range).toFixed(1)}%</text>
      <text x={W - PAD_R} y={H - 6} fontSize={10.5} textAnchor="end" style={{ fill: 'var(--fa-text-tertiary)', fontFamily: 'var(--fa-font-mono)' }}>+{range.toFixed(1)}%</text>
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {items.map(it => {
        const positive = it.value >= 0;
        const color = positive ? 'var(--fa-success)' : 'var(--fa-danger)';
        const barFill = positive ? 'rgba(116,196,118,0.6)' : 'rgba(230,108,92,0.6)';
        const pctOfRange = Math.abs(it.value) / range;
        const W = 300, H = 28;
        const zeroX = W / 2;
        const barX = positive ? zeroX : zeroX - pctOfRange * (W / 2);
        const barW = Math.max(2, pctOfRange * (W / 2));

        return (
          <div key={it.label} style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {/* Label */}
            <div style={{ minWidth: 156, flexShrink: 0 }}>
              <div style={{ fontFamily: 'var(--fa-font-body)', fontSize: 14, color: 'var(--fa-text-primary)', fontWeight: 500 }}>{it.label}</div>
              <div style={{ fontFamily: 'var(--fa-font-body)', fontSize: 12.5, color: 'var(--fa-text-secondary)', marginTop: 2 }}>— {it.sub}</div>
            </div>
            {/* Bar SVG */}
            <div style={{ flex: 1 }}>
              <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: H, display: 'block' }}>
                <line x1={0} y1={H / 2} x2={W} y2={H / 2} style={{ stroke: 'var(--fa-border-soft)', strokeWidth: 1 }} />
                <rect x={barX} y={H / 2 - 5} width={barW} height={10} fill={barFill} rx={2} />
                <line x1={zeroX} y1={4} x2={zeroX} y2={H - 4} style={{ stroke: 'var(--fa-text-tertiary)', strokeWidth: 1 }} />
                <text x={4} y={H - 3} fontSize={9} style={{ fill: 'var(--fa-text-tertiary)', fontFamily: 'var(--fa-font-mono)' }}>{(-range).toFixed(1)}%</text>
                <text x={zeroX} y={H - 3} textAnchor="middle" fontSize={9} style={{ fill: 'var(--fa-text-tertiary)', fontFamily: 'var(--fa-font-mono)' }}>0</text>
                <text x={W - 4} y={H - 3} textAnchor="end" fontSize={9} style={{ fill: 'var(--fa-text-tertiary)', fontFamily: 'var(--fa-font-mono)' }}>+{range.toFixed(1)}%</text>
              </svg>
            </div>
            {/* Value */}
            <div style={{ fontFamily: 'var(--fa-font-mono)', fontSize: 14, fontWeight: 500, fontVariantNumeric: 'tabular-nums', color, minWidth: 58, textAlign: 'right', flexShrink: 0 }}>
              {(positive ? '+' : '−') + Math.abs(it.value).toFixed(2) + '%'}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const metricsGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
  gap: 12,
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
