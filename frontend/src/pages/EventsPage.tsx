import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useDataContext } from '../context/DataContext';
import LoadingSpinner from '../components/LoadingSpinner';
import { fetchMarketMetadata, type PolymarketInfo } from '../services/polymarket';
import MarketCard from '../components/markets/MarketCard';
import { styleForCategory } from '../lib/categoryColor';
import type { Round } from '../types';

// ─── helpers ──────────────────────────────────────────────────────────────────

function formatTimeLeft(ts: number): string {
  const diff = ts - Math.floor(Date.now() / 1000);
  if (diff <= 0) return 'closed';
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  if (h > 48) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ─── useMarketMetadata ────────────────────────────────────────────────────────

function useMarketMetadata(conditionIds: string[]) {
  const [meta, setMeta] = useState<Map<string, PolymarketInfo>>(new Map());
  const [metaLoading, setMetaLoading] = useState(true);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (conditionIds.length === 0) { setMetaLoading(false); return; }
    let cancelled = false;
    setMetaLoading(true);
    fetchMarketMetadata(conditionIds).then(m => {
      if (!cancelled) { setMeta(m); setMetaLoading(false); }
    });
    return () => { cancelled = true; };
  }, [conditionIds.join('|')]); // re-fetch only if the set of ids changes

  return { meta, metaLoading };
}

// ─── CategoryChip ─────────────────────────────────────────────────────────────

function CategoryChip({ label, count, active, onClick }: {
  label: string; count: number; active: boolean; onClick: () => void;
}) {
  const isAll = label === 'All';
  const s = isAll ? null : styleForCategory(label);

  const colorStyle = isAll
    ? {
        color: active ? 'var(--fa-text-inverse)' : 'var(--fa-text-secondary)',
        background: active ? 'var(--fa-gold)' : 'transparent',
        borderColor: active ? 'var(--fa-gold)' : 'var(--fa-border)',
      }
    : (s
        ? (active
            ? { color: 'var(--fa-text-primary)', background: s.bg, borderColor: s.color }
            : { color: 'var(--fa-text-tertiary)', background: 'transparent', borderColor: 'var(--fa-border)' })
        : { color: 'var(--fa-text-secondary)', background: 'transparent', borderColor: 'var(--fa-border)' });

  return (
    <button
      onClick={onClick}
      style={{
        fontFamily: 'var(--fa-font-mono)',
        fontSize: 11,
        textTransform: 'uppercase' as const,
        letterSpacing: '0.1em',
        padding: '6px 12px',
        borderRadius: 999,
        border: '1px solid',
        cursor: 'pointer',
        transition: 'all 120ms ease',
        ...colorStyle,
      }}
    >
      {label} <span style={{ opacity: 0.6, marginLeft: 4 }}>{count}</span>
    </button>
  );
}

// ─── RoundBlock ───────────────────────────────────────────────────────────────

function RoundBlock({ round, marketMeta, selectedCategory }: {
  round: Round;
  marketMeta: Map<string, PolymarketInfo>;
  selectedCategory: string;
}) {
  const closesIn = formatTimeLeft(round.commitDeadline);

  const allDimmed = selectedCategory !== 'all'
    && round.conditionIds.every(cid => marketMeta.get(cid)?.category !== selectedCategory);

  return (
    <section style={{
      background: 'var(--fa-bg-card)',
      border: '1px solid var(--fa-border-soft)',
      borderRadius: 14,
      overflow: 'hidden',
      opacity: allDimmed ? 0.4 : 1,
      transition: 'opacity 200ms ease',
    }}>
      {/* Round header strip */}
      <header style={{
        padding: '20px 24px',
        borderBottom: '1px solid var(--fa-border-soft)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 16, flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <span style={{
            fontFamily: 'var(--fa-font-display)', fontWeight: 400,
            fontVariationSettings: '"opsz" 144, "SOFT" 30',
            fontSize: 22, color: 'var(--fa-text-primary)', lineHeight: 1,
          }}>
            Round {round.roundId}
          </span>
          <span style={{
            fontFamily: 'var(--fa-font-mono)', fontSize: 11,
            textTransform: 'uppercase', letterSpacing: '0.12em',
            padding: '4px 10px', borderRadius: 999,
            background: 'var(--fa-teal-bg)',
            color: 'var(--fa-teal)',
            border: '1px solid rgba(93,191,176,0.3)',
          }}>
            ● Commit
          </span>
          <span style={{
            fontFamily: 'var(--fa-font-mono)', fontSize: 12,
            color: 'var(--fa-text-tertiary)',
          }}>
            {round.conditionIds.length} market{round.conditionIds.length !== 1 ? 's' : ''} · closes in {closesIn}
          </span>
        </div>
        <Link to={`/round/${round.roundId}`} style={{
          fontFamily: 'var(--fa-font-mono)', fontSize: 12,
          color: 'var(--fa-gold)', textDecoration: 'none',
          display: 'inline-flex', alignItems: 'center', gap: 4,
          flexShrink: 0,
        }}>
          View round →
        </Link>
      </header>

      {/* Markets grid */}
      <div style={{
        padding: '20px 24px',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
        gap: 14,
      }}>
        {round.conditionIds.map((cid, i) => {
          const dimmed = selectedCategory !== 'all'
            && marketMeta.get(cid)?.category !== selectedCategory;
          return (
            <MarketCard
              key={cid}
              conditionId={cid}
              benchmarkPrice={round.benchmarkPrices[i] || 5000}
              outcome={round.outcomes?.[i] ?? null}
              info={marketMeta.get(cid)}
              roundId={round.roundId}
              dimmed={dimmed}
            />
          );
        })}
      </div>
    </section>
  );
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function EventsPage() {
  const { rounds, loading } = useDataContext();

  const commitPhaseRounds = useMemo(() => {
    const now = Math.floor(Date.now() / 1000);
    return rounds
      .filter(r => !r.invalidated && r.commitDeadline > now)
      .sort((a, b) => b.roundId - a.roundId);
  }, [rounds]);

  const allConditionIds = useMemo(
    () => commitPhaseRounds.flatMap(r => r.conditionIds),
    [commitPhaseRounds],
  );

  const { meta: marketMeta, metaLoading } = useMarketMetadata(allConditionIds);

  const availableCategories = useMemo(() => {
    const cats = new Set<string>();
    for (const m of marketMeta.values()) {
      if (m.category) cats.add(m.category);
    }
    return Array.from(cats).sort();
  }, [marketMeta]);

  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  const totalMarkets = commitPhaseRounds.reduce((s, r) => s + r.conditionIds.length, 0);

  if (loading) return <LoadingSpinner />;

  return (
    <div className="page">
      {/* ── Header ────────────────────────────────────────────────────── */}
      <header style={{ marginBottom: 32, paddingTop: 'clamp(1rem, 3vw, 2rem)' }}>
        <div style={{
          fontFamily: 'var(--fa-font-mono)', fontSize: 11,
          textTransform: 'uppercase', letterSpacing: '0.14em',
          color: 'var(--fa-gold)', marginBottom: 8,
          display: 'inline-flex', alignItems: 'center', gap: 8,
        }}>
          <span className="fa-live-dot" style={{ background: 'var(--fa-success)', boxShadow: '0 0 0 3px rgba(116,196,118,0.18)' }} />
          Live · Commit phase
        </div>
        <h1 style={{
          fontFamily: 'var(--fa-font-display)', fontWeight: 400,
          fontVariationSettings: '"opsz" 144, "SOFT" 30',
          fontSize: 'clamp(2rem, 4vw, 2.75rem)',
          lineHeight: 1.05, letterSpacing: '-0.02em',
          margin: '12px 0 12px', color: 'var(--fa-text-primary)',
        }}>
          What's predictable right now?
        </h1>
        <p style={{
          fontSize: 15, color: 'var(--fa-text-secondary)',
          maxWidth: '64ch', margin: 0, lineHeight: 1.55,
        }}>
          {commitPhaseRounds.length === 0
            ? 'No round currently open for commits. Browse the archive for past predictions.'
            : `${commitPhaseRounds.length} ${commitPhaseRounds.length === 1 ? 'round' : 'rounds'} open · ${totalMarkets} ${totalMarkets === 1 ? 'market' : 'markets'} total. Sealed predictions, on-chain scoring after resolution.`}
        </p>

        {/* Category filter chips — shown once metadata loaded */}
        {!metaLoading && availableCategories.length > 0 && (
          <div style={{
            display: 'flex', gap: 8, flexWrap: 'wrap',
            marginTop: 20,
            paddingTop: 20,
            borderTop: '1px solid var(--fa-border-soft)',
          }}>
            <CategoryChip
              label="All"
              count={marketMeta.size}
              active={selectedCategory === 'all'}
              onClick={() => setSelectedCategory('all')}
            />
            {availableCategories.map(cat => {
              const count = Array.from(marketMeta.values()).filter(m => m.category === cat).length;
              return (
                <CategoryChip
                  key={cat}
                  label={cat}
                  count={count}
                  active={selectedCategory === cat}
                  onClick={() => setSelectedCategory(cat)}
                />
              );
            })}
          </div>
        )}
      </header>

      {/* ── Content ───────────────────────────────────────────────────── */}
      {commitPhaseRounds.length === 0 ? (
        <div style={{
          padding: '48px 24px',
          background: 'var(--fa-bg-card)',
          border: '1px solid var(--fa-border-soft)',
          borderRadius: 14,
          textAlign: 'center',
          color: 'var(--fa-text-tertiary)',
          fontFamily: 'var(--fa-font-mono)', fontSize: 13,
        }}>
          No round in commit phase right now.{' '}
          <Link to="/rounds" style={{ color: 'var(--fa-gold)' }}>Browse archive →</Link>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
          {commitPhaseRounds.map(round => (
            <RoundBlock
              key={round.roundId}
              round={round}
              marketMeta={marketMeta}
              selectedCategory={selectedCategory}
            />
          ))}
        </div>
      )}
    </div>
  );
}
