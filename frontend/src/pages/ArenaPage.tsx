import { Link } from 'react-router-dom';
import { useDataContext } from '../context/DataContext';
import StatusBadge from '../components/StatusBadge';
import LoadingSpinner from '../components/LoadingSpinner';

function formatTs(ts: number): string {
  if (!ts) return '--';
  return new Date(ts * 1000).toLocaleString();
}

export default function ArenaPage() {
  const { rounds, loading } = useDataContext();

  if (loading) return <LoadingSpinner />;

  const sorted = [...rounds].sort((a, b) => b.roundId - a.roundId);

  return (
    <div className="page">
      <h1>Arena Rounds</h1>
      {sorted.length === 0 ? (
        <p>No rounds found.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Round #</th>
                <th>Markets</th>
                <th>Participants</th>
                <th>Revealed</th>
                <th>Non-Revealers</th>
                <th>Status</th>
                <th>Commit Deadline</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((round) => {
                const participants = round.agents.size;
                const revealed = Array.from(round.agents.values()).filter(
                  (a) => a.revealed
                ).length;
                const nonRevealers = participants - revealed;

                return (
                  <tr key={round.roundId}>
                    <td>
                      <Link to={`/round/${round.roundId}`} className="mono">
                        #{round.roundId}
                      </Link>
                    </td>
                    <td>{round.conditionIds.length}</td>
                    <td>{participants}</td>
                    <td>{revealed}</td>
                    <td>{nonRevealers}</td>
                    <td>
                      <StatusBadge round={round} />
                    </td>
                    <td style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
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
