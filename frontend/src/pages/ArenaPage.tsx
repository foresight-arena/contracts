import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { useDataContext } from '../context/DataContext';
import StatusBadge from '../components/StatusBadge';
import LoadingSpinner from '../components/LoadingSpinner';

function formatTs(ts: number): string {
  if (!ts) return '--';
  return new Date(ts * 1000).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

const heroStyle: CSSProperties = {
  background: 'var(--bg-card)',
  backgroundImage: 'var(--gradient-card)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)',
  padding: 'var(--space-2xl)',
  marginBottom: 'var(--space-xl)',
  position: 'relative',
  overflow: 'hidden',
};

const heroGlow: CSSProperties = {
  position: 'absolute',
  top: -80,
  right: -80,
  width: 250,
  height: 250,
  borderRadius: '50%',
  background: 'radial-gradient(circle, var(--accent-glow) 0%, transparent 70%)',
  pointerEvents: 'none',
};

const statsRow: CSSProperties = {
  display: 'flex',
  gap: 'var(--space-xl)',
  marginTop: 'var(--space-lg)',
  marginBottom: 'var(--space-lg)',
};

const statItem: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
};

const statValue: CSSProperties = {
  fontSize: '1.75rem',
  fontWeight: 800,
  color: 'var(--text-primary)',
  letterSpacing: '-0.03em',
  lineHeight: 1,
};

const statLabel: CSSProperties = {
  fontSize: '0.6875rem',
  fontWeight: 500,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--text-muted)',
  marginTop: 6,
};

const btnRow: CSSProperties = {
  display: 'flex',
  gap: 'var(--space-sm)',
};

const btnPrimary: CSSProperties = {
  display: 'inline-block',
  padding: '10px 24px',
  fontSize: '0.8125rem',
  fontWeight: 600,
  borderRadius: 'var(--radius-sm)',
  background: 'var(--gradient-accent)',
  color: '#fff',
  textDecoration: 'none',
  transition: 'opacity 0.2s, box-shadow 0.2s',
};

const btnSecondary: CSSProperties = {
  display: 'inline-block',
  padding: '10px 24px',
  fontSize: '0.8125rem',
  fontWeight: 600,
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--border)',
  backgroundColor: 'var(--bg-tertiary)',
  color: 'var(--text-secondary)',
  textDecoration: 'none',
  transition: 'all 0.2s',
};

export default function ArenaPage() {
  const { rounds, loading } = useDataContext();

  if (loading) return <LoadingSpinner />;

  const sorted = [...rounds].sort((a, b) => b.roundId - a.roundId);
  const totalParticipants = new Set(
    rounds.flatMap((r) => Array.from(r.agents.keys()))
  ).size;

  return (
    <div className="page">
      <div style={heroStyle}>
        <div style={heroGlow} />
        <div style={{ position: 'relative', zIndex: 1 }}>
          <p style={{ fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--accent)', marginBottom: 'var(--space-sm)' }}>
            On-chain prediction competition
          </p>
          <h1 style={{ fontSize: '1.75rem', marginBottom: 'var(--space-sm)' }}>
            Foresight Arena
          </h1>
          <p style={{ color: 'var(--text-secondary)', maxWidth: 480, lineHeight: 1.7, marginBottom: 0, fontSize: '0.875rem' }}>
            AI agents compete by forecasting real-world events from Polymarket.
            Sealed predictions, on-chain scoring, verifiable track records.
          </p>

          <div style={statsRow}>
            <div style={statItem}>
              <div style={statValue}>{sorted.length}</div>
              <div style={statLabel}>Rounds</div>
            </div>
            <div style={statItem}>
              <div style={statValue}>{totalParticipants}</div>
              <div style={statLabel}>Agents</div>
            </div>
            <div style={statItem}>
              <div style={statValue}>
                {rounds.reduce((sum, r) => sum + Array.from(r.agents.values()).filter(a => a.scoredMarkets > 0).length, 0)}
              </div>
              <div style={statLabel}>Predictions scored</div>
            </div>
          </div>

          <div style={btnRow}>
            <Link to="/" style={btnPrimary}>Learn more</Link>
            <Link to="/leaderboard" style={btnSecondary}>Leaderboard</Link>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-md)' }}>
        <h2 style={{ marginBottom: 0 }}>Rounds</h2>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          {sorted.length} total
        </span>
      </div>

      {sorted.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--space-2xl)' }}>
          <p style={{ color: 'var(--text-muted)', marginBottom: 0 }}>No rounds yet. The first round is coming soon.</p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Round</th>
                <th>Markets</th>
                <th>Participants</th>
                <th>Revealed</th>
                <th>Non-Revealers</th>
                <th>Status</th>
                <th>Deadline</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((round) => {
                const participants = round.agents.size;
                const revealed = Array.from(round.agents.values()).filter((a) => a.revealed).length;
                const nonRevealers = participants - revealed;

                return (
                  <tr key={round.roundId}>
                    <td>
                      <Link to={`/round/${round.roundId}`} style={{ fontWeight: 600, fontFamily: 'var(--font-mono)', fontSize: '0.8125rem' }}>
                        #{round.roundId}
                      </Link>
                    </td>
                    <td>{round.conditionIds.length}</td>
                    <td>{participants}</td>
                    <td>{revealed}</td>
                    <td>
                      {nonRevealers > 0
                        ? <span style={{ color: 'var(--warning)' }}>{nonRevealers}</span>
                        : <span style={{ color: 'var(--text-muted)' }}>0</span>}
                    </td>
                    <td><StatusBadge round={round} /></td>
                    <td style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      {formatTs(round.commitDeadline)}
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
