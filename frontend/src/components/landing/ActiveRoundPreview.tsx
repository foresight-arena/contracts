import { useState, useEffect, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { useDataContext } from '../../context/DataContext';
import { fetchMarketMetadata, type PolymarketInfo } from '../../services/polymarket';
import type { Round } from '../../types';
import MarketCard from '../markets/MarketCard';
import { getActivePhase } from '../../lib/roundPhase';

// ─── Phase types ──────────────────────────────────────────────────────────────

type RoundPhase = 'commit' | 'buffer' | 'reveal' | 'triggered' | 'scored' | 'void';

const eyebrowMap: Record<RoundPhase, string> = {
  commit:    'NOW IN COMMIT PHASE',
  buffer:    'AWAITING REVEAL',
  reveal:    'NOW IN REVEAL PHASE',
  triggered: 'TRIGGERED · AWAITING SCORING',
  scored:    'LATEST ROUND',
  void:      'LATEST ROUND',
};

// ─── Formatters ───────────────────────────────────────────────────────────────

function formatDeadline(ts: number): string {
  if (!ts) return '—';
  return new Date(ts * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}

function formatRevealWindow(round: Round): string {
  if (!round.revealStart || !round.revealDeadline) return '—';
  const fmt = (ts: number) =>
    new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${fmt(round.revealStart)} – ${fmt(round.revealDeadline)}`;
}

// ─── CSS ──────────────────────────────────────────────────────────────────────

const css = `
  .rd-card { background: var(--fa-bg-card); border: 1px solid var(--fa-border-soft); border-radius: 14px; padding: 24px; }
  .rd-meta { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 18px; }
  .rd-markets { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; }
`;

// ─── PhasePill ────────────────────────────────────────────────────────────────

const pillColors: Record<RoundPhase, { bg: string; color: string; border: string }> = {
  commit:    { bg: 'var(--fa-teal-bg)',    color: 'var(--fa-teal)',           border: '1px solid rgba(93,191,176,0.3)' },
  buffer:    { bg: 'var(--fa-danger-bg)', color: 'var(--fa-danger)',          border: '1px solid rgba(230,108,92,0.3)' },
  reveal:    { bg: 'var(--fa-gold-bg)',    color: 'var(--fa-gold)',            border: '1px solid rgba(232,177,74,0.3)' },
  triggered: { bg: 'var(--fa-polygon-bg)', color: 'var(--fa-polygon)',         border: '1px solid rgba(130,71,229,0.35)' },
  scored:    { bg: 'var(--fa-success-bg)', color: 'var(--fa-success)',         border: '1px solid rgba(116,196,118,0.3)' },
  void:      { bg: 'transparent',          color: 'var(--fa-text-tertiary)',   border: '1px solid var(--fa-border-soft)' },
};

const pillLabels: Record<RoundPhase, string> = {
  commit: '● Commit', buffer: '● Awaiting Reveal', reveal: '● Reveal',
  triggered: '● Triggered', scored: '● Scored', void: '● Void',
};

function PhasePill({ phase }: { phase: RoundPhase }) {
  const s = pillColors[phase];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '4px 10px', borderRadius: 999,
      fontFamily: 'var(--fa-font-mono)', fontSize: 11, letterSpacing: '0.06em',
      textTransform: 'uppercase', fontWeight: 500,
      background: s.bg, color: s.color, border: s.border,
    }}>
      {pillLabels[phase]}
    </span>
  );
}

// ─── Section styles ───────────────────────────────────────────────────────────

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

// ─── Component ────────────────────────────────────────────────────────────────

export default function ActiveRoundPreview() {
  const { rounds } = useDataContext();
  const [polyInfo, setPolyInfo] = useState<Map<string, PolymarketInfo>>(new Map());

  const round = rounds.length > 0
    ? rounds.reduce((best, r) => (r.roundId > best.roundId ? r : best))
    : null;

  const phase: RoundPhase = round
    ? getActivePhase(round, Math.floor(Date.now() / 1000))
    : 'void';

  const roundId = round?.roundId;
  useEffect(() => {
    if (!round || round.conditionIds.length === 0) return;
    fetchMarketMetadata(round.conditionIds).then(setPolyInfo);
  }, [roundId]); // re-fetch only when round changes

  if (!round) return null;

  const marketsToShow = round.conditionIds.slice(0, 3);

  return (
    <section style={{ padding: 'clamp(48px, 7vw, 80px) 0', maxWidth: 1240, margin: '0 auto' }}>
      <style>{css}</style>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 32, marginBottom: 32, flexWrap: 'wrap' }}>
        <div>
          <p style={eyebrowStyle}>{eyebrowMap[phase]}</p>
          <h2 style={titleStyle}>
            Round {round.roundId} · {round.conditionIds.length} markets
          </h2>
        </div>
        <Link
          to={`/round/${round.roundId}`}
          style={{ fontSize: 13.5, color: 'var(--fa-text-secondary)', textDecoration: 'none', transition: 'color 120ms ease', flexShrink: 0 }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--fa-text-primary)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--fa-text-secondary)')}
        >
          View round →
        </Link>
      </div>

      <div className="rd-card">
        <div className="rd-meta">
          <PhasePill phase={phase} />
          <span style={{ fontFamily: 'var(--fa-font-mono)', fontSize: 12.5, color: 'var(--fa-text-tertiary)' }}>
            Closes{' '}
            <strong style={{ color: 'var(--fa-text-primary)', fontWeight: 500 }}>
              {formatDeadline(round.commitDeadline)}
            </strong>
            {' · '}Reveal{' '}
            <strong style={{ color: 'var(--fa-text-primary)', fontWeight: 500 }}>
              {formatRevealWindow(round)}
            </strong>
          </span>
        </div>

        <div className="rd-markets">
          {marketsToShow.map((cid, i) => (
            <MarketCard
              key={cid}
              conditionId={cid}
              benchmarkPrice={round.benchmarkPrices[i] || 5000}
              info={polyInfo.get(cid)}
              roundId={round.roundId}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
