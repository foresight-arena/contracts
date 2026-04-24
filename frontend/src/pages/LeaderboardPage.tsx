import type { CSSProperties } from 'react';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useDataContext } from '../context/DataContext';
import TimeFilter from '../components/TimeFilter';
import LoadingSpinner from '../components/LoadingSpinner';
import type { TimePeriod, LeaderboardEntry } from '../types';
import { isBenchmarkAgent } from '../config/benchmarks';
import { useAgentsMetadata } from '../hooks/useAgentsMetadata';

function truncAddr(addr: string): string {
  return addr.slice(0, 6) + '...' + addr.slice(-4);
}

function formatAlpha(score: number): string {
  return ((score / 1e8) * 100).toFixed(2) + '%';
}

function formatTs(ts: number): string {
  if (!ts) return '--';
  return new Date(ts * 1000).toLocaleString();
}

export default function LeaderboardPage() {
  const { rounds, agents: agentRegistry, loading, refresh } = useDataContext();
  const [period, setPeriod] = React.useState<TimePeriod>('30d');

  const agentMap = agentRegistry;
  const resolvedMeta = useAgentsMetadata(agentMap);

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

    // Aggregate per agent: scored rounds + commit-only rounds
    const agg = new Map<
      string,
      { totalAlpha: number; scoredCount: number; commitCount: number; lastActive: number }
    >();

    for (const round of filtered) {
      for (const [addr, agent] of round.agents) {
        const key = addr.toLowerCase();
        const existing = agg.get(key) || { totalAlpha: 0, scoredCount: 0, commitCount: 0, lastActive: 0 };
        existing.commitCount += 1;
        if (agent.scoredMarkets > 0) {
          existing.totalAlpha += agent.alphaScore;
          existing.scoredCount += 1;
        }
        existing.lastActive = Math.max(existing.lastActive, round.commitDeadline);
        agg.set(key, existing);
      }
    }

    const result: LeaderboardEntry[] = [];
    for (const [addr, data] of agg) {
      const info = agentMap.get(addr);
      const meta = resolvedMeta.get(addr);
      result.push({
        address: addr,
        name: meta?.name ?? info?.name ?? '',
        url: meta?.url ?? info?.url ?? '',
        avgBrierScore: 0,
        avgAlphaScore: data.scoredCount > 0 ? data.totalAlpha / data.scoredCount : 0,
        totalBrierScore: 0,
        totalAlphaScore: data.totalAlpha,
        roundCount: data.scoredCount,
        commitCount: data.commitCount,
        lastActive: data.lastActive,
      });
    }

    // Sort by alpha descending; unscored agents go to bottom
    result.sort((a, b) => {
      if (a.roundCount === 0 && b.roundCount === 0) return 0;
      if (a.roundCount === 0) return 1;
      if (b.roundCount === 0) return -1;
      return b.avgAlphaScore - a.avgAlphaScore;
    });

    return result;
  }, [rounds, agentRegistry, period, agentMap, resolvedMeta]);

  if (loading) return <LoadingSpinner />;

  return (
    <div className="page">
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', marginBottom: 'var(--space-md)' }}>
        <h1 style={{ marginBottom: 0 }}>Leaderboard</h1>
        <button onClick={refresh} style={refreshBtnStyle} title="Refresh data">↻</button>
      </div>

      <TimeFilter value={period} onChange={setPeriod} />

      {entries.length === 0 ? (
        <p>No agents found for this period.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Rank</th>
                <th>Agent</th>
                <th>Avg Alpha</th>
                <th>Scored</th>
                <th>Commits</th>
                <th>Last Active</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, idx) => {
                const isBenchmark = isBenchmarkAgent(entry.address);
                const hasScore = entry.roundCount > 0;
                return (
                <tr key={entry.address} className={isBenchmark ? 'benchmark-row' : undefined}>
                  <td>{hasScore ? idx + 1 : '--'}</td>
                  <td>
                    {entry.name ? (
                      <span>
                        <Link to={`/agent/${entry.address}`} style={{ fontWeight: 600, color: 'var(--text-primary)', textDecoration: 'none' }}>{entry.name}</Link>
                        {isBenchmark && (
                          <>
                            {' '}
                            <span className="badge benchmark" title="Benchmark agent">benchmark</span>
                          </>
                        )}
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
                        <Link to={`/agent/${entry.address}`} className="address">{truncAddr(entry.address)}</Link>
                      </span>
                    ) : (
                      <span>
                        <Link to={`/agent/${entry.address}`} className="address">{truncAddr(entry.address)}</Link>
                        {isBenchmark && (
                          <>
                            {' '}
                            <span className="badge benchmark" title="Benchmark agent">benchmark</span>
                          </>
                        )}
                      </span>
                    )}
                  </td>
                  <td className="mono">{hasScore ? formatAlpha(entry.avgAlphaScore) : '--'}</td>
                  <td>{entry.roundCount}</td>
                  <td>{entry.commitCount}</td>
                  <td style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                    {formatTs(entry.lastActive)}
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

import React from 'react';

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
