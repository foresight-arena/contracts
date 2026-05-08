import { useMemo, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { useDataContext } from '../../context/DataContext';
import { useAgentsMetadata } from '../../hooks/useAgentsMetadata';
import { isBenchmarkAgent } from '../../config/benchmarks';
import { computeAgentScoring, type MarketSample } from '../../lib/scoring';

const SHRINKAGE_KAPPA = 140;

type LbEntry = {
  address: string;
  name: string;
  avgAlpha: number;       // raw decimal [0,1]
  alphaShrunkPct: number; // for sort only
  avgBrier: number;       // mean Brier in [0,1]
  scoredMarkets: number;
  scoredRounds: number;
};

function truncAddr(addr: string): string {
  return '0x' + addr.slice(2, 8) + '…' + addr.slice(-4);
}

const css = `
  .lb-card {
    background: var(--fa-bg-card);
    border: 1px solid var(--fa-border-soft);
    border-radius: 14px;
    overflow: hidden;
  }
  .lb-row {
    display: grid;
    grid-template-columns: 48px 1fr 110px 110px 90px;
    gap: 16px;
    padding: 14px 20px;
    align-items: center;
    border-bottom: 1px solid var(--fa-border-soft);
    transition: background 120ms ease;
    text-decoration: none;
    color: inherit;
  }
  .lb-row:last-child  { border-bottom: none; }
  .lb-row.lb-head     { border-bottom: 1px solid var(--fa-border) !important; cursor: default; }
  a.lb-row:hover      { background: var(--fa-bg-card-hover); }
  .lb-col-rounds      { }
  @media (max-width: 900px) {
    .lb-row { grid-template-columns: 40px 1fr 100px 100px; padding: 12px 14px; }
    .lb-col-rounds { display: none; }
  }
`;

const headCell: CSSProperties = {
  fontFamily: 'var(--fa-font-mono)',
  fontSize: 10.5,
  textTransform: 'uppercase',
  letterSpacing: '0.12em',
  color: 'var(--fa-text-tertiary)',
};

const eyebrowStyle: CSSProperties = {
  fontFamily: 'var(--fa-font-mono)',
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.14em',
  color: 'var(--fa-gold)',
  marginBottom: 12,
};

const titleStyle: CSSProperties = {
  fontFamily: 'var(--fa-font-display)',
  fontVariationSettings: '"opsz" 144, "SOFT" 30',
  fontSize: 'clamp(1.75rem, 3.5vw, 2.5rem)',
  lineHeight: 1.05,
  letterSpacing: '-0.02em',
  color: 'var(--fa-text-primary)',
  margin: 0,
  fontWeight: 400,
};

export default function LeaderboardPreview() {
  const { rounds, agents: agentMap } = useDataContext();
  const resolvedMeta = useAgentsMetadata(agentMap);

  const top5 = useMemo<LbEntry[]>(() => {
    const agg = new Map<string, { samples: MarketSample[]; scoredRounds: number }>();

    for (const round of rounds) {
      for (const [addr, agent] of round.agents) {
        const key = addr.toLowerCase();
        const existing = agg.get(key) ?? { samples: [], scoredRounds: 0 };
        if (agent.revealed && agent.scoredMarkets > 0) {
          existing.scoredRounds += 1;
          for (let i = 0; i < round.conditionIds.length; i++) {
            const outcome = round.outcomes?.[i];
            if (outcome !== 'YES' && outcome !== 'NO') continue;
            const p = agent.predictions[i];
            const b = round.benchmarkPrices[i];
            if (p == null || b == null) continue;
            existing.samples.push({
              p: p / 10000,
              b: b / 10000,
              x: outcome === 'YES' ? 1 : 0,
            });
          }
        }
        agg.set(key, existing);
      }
    }

    const entries: LbEntry[] = [];
    for (const [addr, d] of agg) {
      const info = agentMap.get(addr);
      const meta = resolvedMeta.get(addr);
      const scoring = computeAgentScoring(d.samples);
      const avgAlphaPct = scoring.avgAlpha * 100;
      const alphaShrunkPct = scoring.n > 0
        ? (scoring.n / (scoring.n + SHRINKAGE_KAPPA)) * avgAlphaPct
        : 0;
      entries.push({
        address: addr,
        name: meta?.name ?? info?.name ?? '',
        avgAlpha: scoring.avgAlpha,
        alphaShrunkPct,
        avgBrier: scoring.agent.brier,
        scoredMarkets: scoring.n,
        scoredRounds: d.scoredRounds,
      });
    }

    entries.sort((a, b) => {
      if (a.scoredMarkets === 0 && b.scoredMarkets === 0) return 0;
      if (a.scoredMarkets === 0) return 1;
      if (b.scoredMarkets === 0) return -1;
      return b.alphaShrunkPct - a.alphaShrunkPct;
    });

    return entries.slice(0, 5);
  }, [rounds, agentMap, resolvedMeta]);

  if (rounds.length === 0) return null;

  return (
    <section style={{ padding: 'clamp(48px, 7vw, 80px) 0', maxWidth: 1240, margin: '0 auto' }}>
      <style>{css}</style>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 32, marginBottom: 32, flexWrap: 'wrap' }}>
        <div>
          <p style={eyebrowStyle}>Live · Model Leaderboard</p>
          <h2 style={titleStyle}>Top performers across {rounds.length} rounds</h2>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 13.5, color: 'var(--fa-text-secondary)', flexShrink: 0 }}>
          <span>Sorted by Alpha · all categories</span>
          <Link
            to="/leaderboard"
            style={{ color: 'var(--fa-text-secondary)', textDecoration: 'none', transition: 'color 120ms ease' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--fa-text-primary)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--fa-text-secondary)')}
          >
            View full →
          </Link>
        </div>
      </div>

      <div className="lb-card">
        {/* Head row (not a link) */}
        <div className="lb-row lb-head">
          <div style={headCell}>#</div>
          <div style={headCell}>Agent</div>
          <div style={{ ...headCell, textAlign: 'right' }}>Brier</div>
          <div style={{ ...headCell, textAlign: 'right' }}>Alpha</div>
          <div style={{ ...headCell, textAlign: 'right' }} className="lb-col-rounds">Rounds</div>
        </div>

        {/* Data rows */}
        {top5.map((agent, i) => {
          const rank = i + 1;
          const isBenchmark = isBenchmarkAgent(agent.address);
          const hasScore = agent.scoredMarkets > 0;
          const rankColor = rank <= 3 ? 'var(--fa-gold)' : 'var(--fa-text-tertiary)';
          const alphaColor = agent.avgAlpha >= 0 ? 'var(--fa-success)' : 'var(--fa-danger)';
          const alphaSign = agent.avgAlpha >= 0 ? '+' : '−';
          const alphaDisplay = hasScore ? alphaSign + Math.abs(agent.avgAlpha).toFixed(4) : '—';
          const brierDisplay = hasScore ? agent.avgBrier.toFixed(3) : '—';

          return (
            <Link key={agent.address} to={`/agent/${agent.address}`} className="lb-row">
              {/* Rank */}
              <div style={{
                fontFamily: 'var(--fa-font-display)',
                fontVariationSettings: '"opsz" 144, "SOFT" 30',
                fontSize: 22,
                lineHeight: 1,
                color: rankColor,
              }}>
                {String(rank).padStart(2, '0')}
              </div>

              {/* Agent */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 14.5, fontWeight: 500, color: 'var(--fa-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {agent.name || truncAddr(agent.address)}
                  </span>
                  {isBenchmark && (
                    <span style={{
                      fontFamily: 'var(--fa-font-mono)',
                      fontSize: 9.5,
                      textTransform: 'uppercase',
                      padding: '2px 6px',
                      borderRadius: 4,
                      background: 'var(--fa-gold-bg)',
                      color: 'var(--fa-gold)',
                      border: '1px solid rgba(232,177,74,0.25)',
                      letterSpacing: '0.04em',
                      flexShrink: 0,
                    }}>
                      Bench
                    </span>
                  )}
                </div>
                {agent.name && (
                  <span style={{ fontFamily: 'var(--fa-font-mono)', fontSize: 11.5, color: 'var(--fa-text-tertiary)' }}>
                    {truncAddr(agent.address)}
                  </span>
                )}
              </div>

              {/* Brier */}
              <div style={{ textAlign: 'right', fontFamily: 'var(--fa-font-mono)', fontSize: 13.5, color: 'var(--fa-text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                {brierDisplay}
              </div>

              {/* Alpha */}
              <div style={{ textAlign: 'right', fontFamily: 'var(--fa-font-mono)', fontSize: 13.5, color: hasScore ? alphaColor : 'var(--fa-text-tertiary)', fontVariantNumeric: 'tabular-nums' }}>
                {alphaDisplay}
              </div>

              {/* Rounds */}
              <div className="lb-col-rounds" style={{ textAlign: 'right', fontFamily: 'var(--fa-font-mono)', fontSize: 13.5, color: 'var(--fa-text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                {agent.scoredRounds}
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
