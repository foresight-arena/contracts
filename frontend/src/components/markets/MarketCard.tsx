import { useState } from 'react';
import type { PolymarketInfo } from '../../services/polymarket';
import { styleForCategory } from '../../lib/categoryColor';

export type MarketCardProps = {
  conditionId: string;
  info?: PolymarketInfo;
  benchmarkPrice?: number;   // basis points 0–10000; undefined → show 50/50
  outcome?: string | null;   // 'YES' | 'NO' | null
  roundId: number;
  dimmed?: boolean;
};

export default function MarketCard({ conditionId, info, benchmarkPrice, outcome, roundId, dimmed }: MarketCardProps) {
  const [hovered, setHovered] = useState(false);

  const yesPrice = benchmarkPrice != null && benchmarkPrice > 0
    ? benchmarkPrice / 10000
    : 0.5;
  const yesPct = Math.max(0, Math.min(100, Math.round(yesPrice * 100)));
  const noPct = 100 - yesPct;

  const href = info?.url || `/round/${roundId}`;
  const isExternal = !!info?.url;

  const cs = styleForCategory(info?.category);

  const endDateDisplay = (() => {
    if (!info?.endDate) return null;
    const d = new Date(info.endDate);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  })();

  return (
    <a
      href={href}
      target={isExternal ? '_blank' : undefined}
      rel={isExternal ? 'noopener noreferrer' : undefined}
      style={{
        display: 'flex', flexDirection: 'column', gap: 12,
        background: hovered ? 'var(--fa-bg-card-hover)' : 'var(--fa-bg-base)',
        border: `1px solid ${hovered ? 'var(--fa-border)' : 'var(--fa-border-soft)'}`,
        borderRadius: 10, padding: 16,
        textDecoration: 'none', color: 'inherit',
        transform: hovered ? 'translateY(-1px)' : 'none',
        opacity: dimmed ? 0.3 : 1,
        pointerEvents: dimmed ? 'none' : 'auto',
        transition: 'border-color 160ms ease, background 160ms ease, transform 160ms ease, opacity 200ms ease',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Title + category */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div style={{
          fontSize: 14, fontWeight: 500, lineHeight: 1.4, flex: 1,
          color: info?.title ? 'var(--fa-text-primary)' : 'var(--fa-text-tertiary)',
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>
          {info?.title ?? (
            <span style={{ fontFamily: 'var(--fa-font-mono)', fontSize: 12, fontStyle: 'italic' }}>
              #{conditionId.slice(2, 10)}…{conditionId.slice(-6)}
            </span>
          )}
        </div>
        {cs && (
          <span style={{
            fontFamily: 'var(--fa-font-mono)',
            textTransform: 'uppercase', letterSpacing: '0.1em',
            fontSize: 9, padding: '2px 7px', borderRadius: 999, flexShrink: 0,
            color: cs.color, background: cs.bg, border: `1px solid ${cs.border}`,
          }}>
            {info!.category}
          </span>
        )}
      </div>

      {/* YES/NO bar */}
      <div style={{ display: 'flex', height: 6, borderRadius: 999, overflow: 'hidden', background: 'var(--fa-border-soft)' }}>
        <div style={{ width: `${yesPct}%`, background: 'var(--fa-gold)' }} />
        <div style={{ flex: 1, background: 'var(--fa-border-strong)' }} />
      </div>

      {/* Prices */}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--fa-font-mono)', fontSize: 12.5 }}>
        <span style={{ color: 'var(--fa-gold)' }}>YES {yesPct}¢</span>
        <span style={{ color: 'var(--fa-text-tertiary)' }}>NO {noPct}¢</span>
      </div>

      {/* Footer */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        fontSize: 11, color: 'var(--fa-text-tertiary)', fontFamily: 'var(--fa-font-mono)',
        borderTop: '1px solid var(--fa-border-soft)', paddingTop: 10,
      }}>
        {outcome ? (
          <span style={{
            color: outcome === 'YES' ? 'var(--fa-success)' : 'var(--fa-danger)',
            textTransform: 'uppercase', letterSpacing: '0.1em',
          }}>
            Resolved: {outcome}
          </span>
        ) : endDateDisplay ? (
          <span>Ends {endDateDisplay}</span>
        ) : (
          <span>—</span>
        )}
        {isExternal && <span>Polymarket ↗</span>}
      </div>
    </a>
  );
}
