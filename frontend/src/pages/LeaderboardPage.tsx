import type { CSSProperties } from 'react';
import { useState, useMemo } from 'react';
import { useDataContext } from '../context/DataContext';
import TimeFilter from '../components/TimeFilter';
import LoadingSpinner from '../components/LoadingSpinner';
import type { TimePeriod, LeaderboardEntry } from '../types';

function truncAddr(addr: string): string {
  return addr.slice(0, 6) + '...' + addr.slice(-4);
}

function formatBrier(score: number): string {
  return ((score / 1e8) * 100).toFixed(2) + '%';
}

function formatAlpha(score: number): string {
  return ((score / 1e8) * 100).toFixed(2) + '%';
}

function formatTs(ts: number): string {
  if (!ts) return '--';
  return new Date(ts * 1000).toLocaleString();
}

type SortMode = 'brier' | 'alpha';

const toggleStyle: CSSProperties = {
  display: 'flex',
  gap: 'var(--space-xs)',
  marginBottom: 'var(--space-lg)',
};

function sortBtnStyle(active: boolean): CSSProperties {
  return {
    padding: '6px 14px',
    fontSize: '0.8125rem',
    fontWeight: 600,
    border: '1px solid',
    borderColor: active ? 'var(--accent)' : 'var(--border)',
    borderRadius: 'var(--radius-sm)',
    backgroundColor: active ? 'var(--accent)' : 'var(--bg-tertiary)',
    color: active ? '#000' : 'var(--text-secondary)',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  };
}

export default function LeaderboardPage() {
  const { rounds, agents: agentRegistry, loading } = useDataContext();
  const [period, setPeriod] = useState<TimePeriod>('all');
  const [sortMode, setSortMode] = useState<SortMode>('brier');

  // agentRegistry is Map<string, AgentInfo> keyed by address
  const agentMap = agentRegistry;

  const entries = useMemo(() => {
    const now = Math.floor(Date.now() / 1000);
    let filtered = rounds;

    if (period === '7d') {
      const cutoff = now - 7 * 24 * 60 * 60;
      filtered = rounds.filter((r) => r.commitDeadline >= cutoff);
    } else if (period === '30d') {
      const cutoff = now - 30 * 24 * 60 * 60;
      filtered = rounds.filter((r) => r.commitDeadline >= cutoff);
    }

    // Aggregate per agent
    const agg = new Map<
      string,
      { totalBrier: number; totalAlpha: number; count: number; lastActive: number }
    >();

    for (const round of filtered) {
      for (const [addr, agent] of round.agents) {
        if (agent.scoredMarkets === 0) continue;
        const key = addr.toLowerCase();
        const existing = agg.get(key) || { totalBrier: 0, totalAlpha: 0, count: 0, lastActive: 0 };
        existing.totalBrier += agent.brierScore;
        existing.totalAlpha += agent.alphaScore;
        existing.count += 1;
        existing.lastActive = Math.max(existing.lastActive, round.commitDeadline);
        agg.set(key, existing);
      }
    }

    const result: LeaderboardEntry[] = [];
    for (const [addr, data] of agg) {
      const info = agentMap.get(addr);
      result.push({
        address: addr,
        name: info?.name ?? '',
        url: info?.url ?? '',
        avgBrierScore: data.count > 0 ? data.totalBrier / data.count : 0,
        avgAlphaScore: data.count > 0 ? data.totalAlpha / data.count : 0,
        totalBrierScore: data.totalBrier,
        totalAlphaScore: data.totalAlpha,
        roundCount: data.count,
        lastActive: data.lastActive,
      });
    }

    if (sortMode === 'brier') {
      result.sort((a, b) => a.avgBrierScore - b.avgBrierScore); // ascending, lower is better
    } else {
      result.sort((a, b) => b.avgAlphaScore - a.avgAlphaScore); // descending, higher is better
    }

    return result;
  }, [rounds, agentRegistry, period, sortMode, agentMap]);

  if (loading) return <LoadingSpinner />;

  return (
    <div className="page">
      <h1>Leaderboard</h1>

      <TimeFilter value={period} onChange={setPeriod} />

      <div style={toggleStyle}>
        <button style={sortBtnStyle(sortMode === 'brier')} onClick={() => setSortMode('brier')}>
          By Brier Score
        </button>
        <button style={sortBtnStyle(sortMode === 'alpha')} onClick={() => setSortMode('alpha')}>
          By Alpha Score
        </button>
      </div>

      {entries.length === 0 ? (
        <p>No scored agents found for this period.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Rank</th>
                <th>Agent</th>
                <th>Avg Brier</th>
                <th>Avg Alpha</th>
                <th>Rounds</th>
                <th>Last Active</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, idx) => (
                <tr key={entry.address}>
                  <td>{idx + 1}</td>
                  <td>
                    {entry.name ? (
                      <span>
                        <span style={{ fontWeight: 600 }}>{entry.name}</span>
                        {entry.url && (
                          <>
                            {' '}
                            <a
                              href={entry.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ fontSize: '0.75rem' }}
                            >
                              [link]
                            </a>
                          </>
                        )}
                        <br />
                        <span className="address">{truncAddr(entry.address)}</span>
                      </span>
                    ) : (
                      <span className="address">{truncAddr(entry.address)}</span>
                    )}
                  </td>
                  <td className="mono">{formatBrier(entry.avgBrierScore)}</td>
                  <td className="mono">{formatAlpha(entry.avgAlphaScore)}</td>
                  <td>{entry.roundCount}</td>
                  <td style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                    {formatTs(entry.lastActive)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
