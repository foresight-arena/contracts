import type { CSSProperties } from 'react';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useDataContext } from '../context/DataContext';
import TimeFilter from '../components/TimeFilter';
import LoadingSpinner from '../components/LoadingSpinner';
import type { TimePeriod } from '../types';
import { isBenchmarkAgent } from '../config/benchmarks';
import { useAgentsMetadata } from '../hooks/useAgentsMetadata';
import { computeAgentScoring, type MarketSample } from '../lib/scoring';

interface LeaderboardRow {
  address: string;
  name: string;
  url: string;
  avgAlphaPct: number;        // mean δ in %, from per-market computation
  alphaCIHalfPct: number;     // 1.96 * SE in %
  scoredMarkets: number;
  scoredRounds: number;
  commitCount: number;
  lastActive: number;
}

function truncAddr(addr: string): string {
  return addr.slice(0, 6) + '...' + addr.slice(-4);
}

function formatSignedPct(v: number): string {
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
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

    // Aggregate per agent: per-market samples + commit/scored counts
    const agg = new Map<
      string,
      { samples: MarketSample[]; scoredRounds: number; commitCount: number; lastActive: number }
    >();

    for (const round of filtered) {
      for (const [addr, agent] of round.agents) {
        const key = addr.toLowerCase();
        const existing = agg.get(key) || { samples: [], scoredRounds: 0, commitCount: 0, lastActive: 0 };
        existing.commitCount += 1;
        existing.lastActive = Math.max(existing.lastActive, round.commitDeadline);

        if (agent.revealed && agent.scoredMarkets > 0) {
          existing.scoredRounds += 1;
          const benchmarks = round.benchmarkPrices;
          const preds = agent.predictions;
          for (let i = 0; i < round.conditionIds.length; i++) {
            const outcome = round.outcomes?.[i];
            if (outcome !== 'YES' && outcome !== 'NO') continue;
            if (preds[i] == null || benchmarks[i] == null) continue;
            existing.samples.push({
              p: preds[i] / 10000,
              b: benchmarks[i] / 10000,
              x: outcome === 'YES' ? 1 : 0,
            });
          }
        }

        agg.set(key, existing);
      }
    }

    const result: LeaderboardRow[] = [];
    for (const [addr, data] of agg) {
      const info = agentMap.get(addr);
      const meta = resolvedMeta.get(addr);
      const scoring = computeAgentScoring(data.samples);
      result.push({
        address: addr,
        name: meta?.name ?? info?.name ?? '',
        url: meta?.url ?? info?.url ?? '',
        avgAlphaPct: scoring.avgAlpha * 100,
        alphaCIHalfPct: scoring.alphaSE * 1.96 * 100,
        scoredMarkets: scoring.n,
        scoredRounds: data.scoredRounds,
        commitCount: data.commitCount,
        lastActive: data.lastActive,
      });
    }

    // Sort by alpha descending; unscored agents go to bottom
    result.sort((a, b) => {
      if (a.scoredMarkets === 0 && b.scoredMarkets === 0) return 0;
      if (a.scoredMarkets === 0) return 1;
      if (b.scoredMarkets === 0) return -1;
      return b.avgAlphaPct - a.avgAlphaPct;
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
                <th title="Mean per-market α (Brier reduction vs Polymarket benchmark) ± 95% CI. Computed across all scored markets in the period.">Avg Alpha (95% CI)</th>
                <th>Scored</th>
                <th>Commits</th>
                <th>Last Active</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, idx) => {
                const isBenchmark = isBenchmarkAgent(entry.address);
                const hasScore = entry.scoredMarkets > 0;
                const lower = entry.avgAlphaPct - entry.alphaCIHalfPct;
                const upper = entry.avgAlphaPct + entry.alphaCIHalfPct;
                const crossesZero = lower < 0 && upper > 0;
                const alphaColor = !hasScore || crossesZero
                  ? 'var(--text-primary)'
                  : (entry.avgAlphaPct >= 0 ? '#10b981' : '#ef4444');
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
                  <td className="mono" style={{ whiteSpace: 'nowrap' }}>
                    {hasScore ? (
                      <>
                        <span style={{ color: alphaColor, fontWeight: 600 }}>{formatSignedPct(entry.avgAlphaPct)}</span>
                        <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> ± {entry.alphaCIHalfPct.toFixed(2)}%</span>
                      </>
                    ) : '--'}
                  </td>
                  <td title={hasScore ? `${entry.scoredMarkets} markets across ${entry.scoredRounds} rounds` : ''}>
                    {hasScore ? `${entry.scoredRounds}r / ${entry.scoredMarkets}m` : '--'}
                  </td>
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
