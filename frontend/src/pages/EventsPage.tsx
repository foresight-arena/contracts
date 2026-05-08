import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useDataContext } from '../context/DataContext';
import LoadingSpinner from '../components/LoadingSpinner';
import { fetchMarketMetadata, type PolymarketInfo } from '../services/polymarket';
import MarketCard from '../components/markets/MarketCard';
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

// ─── RoundBlock ───────────────────────────────────────────────────────────────

function RoundBlock({ round }: { round: Round }) {
  const [polyInfo, setPolyInfo] = useState<Map<string, PolymarketInfo>>(new Map());

  useEffect(() => {
    if (round.conditionIds.length === 0) return;
    fetchMarketMetadata(round.conditionIds).then(setPolyInfo);
  }, [round.roundId]);

  const closesIn = formatTimeLeft(round.commitDeadline);

  return (
    <section style={{
      background: 'var(--fa-bg-card)',
      border: '1px solid var(--fa-border-soft)',
      borderRadius: 14,
      overflow: 'hidden',
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
        {round.conditionIds.map((cid, i) => (
          <MarketCard
            key={cid}
            conditionId={cid}
            benchmarkPrice={round.benchmarkPrices[i] || 5000}
            outcome={round.outcomes?.[i] ?? null}
            info={polyInfo.get(cid)}
            roundId={round.roundId}
          />
        ))}
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
      .sort((a, b) => a.commitDeadline - b.commitDeadline);
  }, [rounds]);

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
            <RoundBlock key={round.roundId} round={round} />
          ))}
        </div>
      )}
    </div>
  );
}
