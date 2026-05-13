import { useState } from 'react';
import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { useDataContext } from '../context/DataContext';
import StatusBadge from '../components/StatusBadge';
import LoadingSpinner from '../components/LoadingSpinner';

const PAGE_SIZE = 50;

function formatTs(ts: number): string {
  if (!ts) return '--';
  return new Date(ts * 1000).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

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

export default function RoundsPage() {
  const { rounds, loading, refresh } = useDataContext();
  const [page, setPage] = useState(1);

  if (loading) return <LoadingSpinner />;

  const sorted = [...rounds].sort((a, b) => b.roundId - a.roundId);
  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const pageRounds = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="page">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-md)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
          <h2 style={{ marginBottom: 0 }}>Rounds</h2>
          <button onClick={refresh} style={refreshBtnStyle} title="Refresh data">↻</button>
        </div>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          {sorted.length} total
        </span>
      </div>

      {sorted.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--space-2xl)' }}>
          <p style={{ color: 'var(--text-muted)', marginBottom: 0 }}>No rounds yet. The first round is coming soon.</p>
        </div>
      ) : (
        <>
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
                {pageRounds.map((round) => {
                  const participants = round.agents.size;
                  const revealed = Array.from(round.agents.values()).filter((a) => a.revealed).length;
                  const nonRevealers = participants - revealed;

                  return (
                    <tr key={round.roundId}>
                      <td>
                        <Link to={`/round/${round.roundId}`} style={{ fontWeight: 600, fontFamily: 'var(--fa-font-mono)', fontSize: '0.8125rem' }}>
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

          {totalPages > 1 && (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              gap: 8, marginTop: 20,
            }}>
              <button
                onClick={() => setPage(p => p - 1)}
                disabled={page === 1}
                style={{
                  fontFamily: 'var(--fa-font-mono)', fontSize: 12,
                  padding: '5px 14px', borderRadius: 6, cursor: page === 1 ? 'default' : 'pointer',
                  background: 'none', border: '1px solid var(--fa-border-soft)',
                  color: page === 1 ? 'var(--fa-text-tertiary)' : 'var(--fa-text-secondary)',
                  opacity: page === 1 ? 0.4 : 1,
                }}
              >
                ← Prev
              </button>

              <span style={{ fontFamily: 'var(--fa-font-mono)', fontSize: 12, color: 'var(--fa-text-tertiary)' }}>
                {page} / {totalPages}
              </span>

              <button
                onClick={() => setPage(p => p + 1)}
                disabled={page === totalPages}
                style={{
                  fontFamily: 'var(--fa-font-mono)', fontSize: 12,
                  padding: '5px 14px', borderRadius: 6, cursor: page === totalPages ? 'default' : 'pointer',
                  background: 'none', border: '1px solid var(--fa-border-soft)',
                  color: page === totalPages ? 'var(--fa-text-tertiary)' : 'var(--fa-text-secondary)',
                  opacity: page === totalPages ? 0.4 : 1,
                }}
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
