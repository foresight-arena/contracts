import { useState, useEffect, type CSSProperties } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useDataContext } from '../context/DataContext';
import StatusBadge from '../components/StatusBadge';
import LoadingSpinner from '../components/LoadingSpinner';
import { fetchMarketMetadata, type PolymarketInfo } from '../services/polymarket';
import type { AgentRoundData } from '../types';

function truncAddr(addr: string): string {
  return addr.slice(0, 6) + '...' + addr.slice(-4);
}

function formatTs(ts: number): string {
  if (!ts) return '--';
  return new Date(ts * 1000).toLocaleString();
}

function formatPct(value: number): string {
  const pct = (value / 10000) * 100;
  return pct % 1 === 0 ? pct.toFixed(0) + '%' : pct.toFixed(2) + '%';
}

function formatBrier(score: number): string {
  const pct = (score / 1e8) * 100;
  return pct % 1 === 0 ? pct.toFixed(0) + '%' : pct.toFixed(2) + '%';
}

function formatAlpha(score: number): string {
  const pct = (score / 1e8) * 100;
  return pct % 1 === 0 ? pct.toFixed(0) + '%' : pct.toFixed(2) + '%';
}

function truncConditionId(id: string): string {
  if (id.length <= 16) return id;
  return id.slice(0, 10) + '...' + id.slice(-6);
}

const sectionStyle: CSSProperties = {
  marginBottom: 'var(--space-xl)',
};

const metaGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
  gap: 'var(--space-md)',
  marginBottom: 'var(--space-xl)',
};

const metaCardStyle: CSSProperties = {
  backgroundColor: 'var(--bg-secondary)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  padding: 'var(--space-md)',
};

const metaLabelStyle: CSSProperties = {
  fontSize: '0.75rem',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.05em',
  color: 'var(--text-secondary)',
  marginBottom: 'var(--space-xs)',
};

const metaValueStyle: CSSProperties = {
  fontSize: '0.9375rem',
  fontWeight: 600,
  color: 'var(--text-primary)',
};

export default function RoundDetailPage() {
  const { roundId } = useParams<{ roundId: string }>();
  const { rounds, agents: agentRegistry, loading } = useDataContext();

  const round = rounds.find((r) => r.roundId === Number(roundId));

  // Fetch Polymarket metadata for this round's markets
  const [marketMeta, setMarketMeta] = useState<Map<string, PolymarketInfo>>(new Map());
  useEffect(() => {
    if (round) {
      fetchMarketMetadata(round.conditionIds).then(setMarketMeta);
    }
  }, [round]);

  if (loading) return <LoadingSpinner />;

  if (!round) {
    return (
      <div className="page">
        <h1>Round not found</h1>
        <p>
          Round #{roundId} does not exist.{' '}
          <Link to="/">Back to Arena</Link>
        </p>
      </div>
    );
  }

  const agentMap = agentRegistry;
  const agentEntries = Array.from(round.agents.values());

  return (
    <div className="page">
      <div style={{ marginBottom: 'var(--space-md)' }}>
        <Link to="/" style={{ fontSize: '0.875rem' }}>
          &larr; Back to Arena
        </Link>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', marginBottom: 'var(--space-lg)' }}>
        <h1 style={{ marginBottom: 0 }}>Round #{round.roundId}</h1>
        <StatusBadge round={round} />
      </div>

      <div style={metaGridStyle}>
        <div style={metaCardStyle}>
          <div style={metaLabelStyle}>Commit Deadline</div>
          <div style={metaValueStyle}>{formatTs(round.commitDeadline)}</div>
        </div>
        <div style={metaCardStyle}>
          <div style={metaLabelStyle}>Reveal Start</div>
          <div style={metaValueStyle}>{formatTs(round.revealStart)}</div>
        </div>
        <div style={metaCardStyle}>
          <div style={metaLabelStyle}>Reveal Deadline</div>
          <div style={metaValueStyle}>{formatTs(round.revealDeadline)}</div>
        </div>
        <div style={metaCardStyle}>
          <div style={metaLabelStyle}>Markets</div>
          <div style={metaValueStyle}>{round.conditionIds.length}</div>
        </div>
      </div>

      {/* Markets Table */}
      <div style={sectionStyle}>
        <h2>Markets</h2>
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Market</th>
                <th>Benchmark</th>
                <th>Outcome</th>
              </tr>
            </thead>
            <tbody>
              {round.conditionIds.map((cid, idx) => {
                const meta = marketMeta.get(cid);
                const outcome = round.outcomes?.[idx];
                return (
                  <tr key={idx}>
                    <td>{idx + 1}</td>
                    <td>
                      {meta?.url ? (
                        <a href={meta.url} target="_blank" rel="noopener noreferrer">
                          {meta.title}
                        </a>
                      ) : (
                        <span>{meta?.title || truncConditionId(cid)}</span>
                      )}
                      <br />
                      <span className="mono" style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }} title={cid}>
                        {truncConditionId(cid)}
                      </span>
                    </td>
                    <td className="mono">
                      {round.benchmarkPrices[idx] != null
                        ? formatPct(round.benchmarkPrices[idx])
                        : '--'}
                    </td>
                    <td>
                      {outcome ? (
                        <span className={`badge ${outcome === 'YES' ? 'success' : 'error'}`}>
                          {outcome}
                        </span>
                      ) : (
                        <span className="badge">Pending</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Agents Table */}
      <div style={sectionStyle}>
        <h2>Agents</h2>
        {agentEntries.length === 0 ? (
          <p>No agents participated in this round.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Status</th>
                  <th>Predictions</th>
                  <th>Brier Score</th>
                  <th>Alpha Score</th>
                  <th>Scored Markets</th>
                </tr>
              </thead>
              <tbody>
                {agentEntries.map((agent: AgentRoundData) => {
                  const info = agentMap.get(agent.address.toLowerCase());
                  return (
                    <tr key={agent.address}>
                      <td>
                        {info?.name ? (
                          <span>
                            <span style={{ fontWeight: 600 }}>{info.name}</span>
                            {info.url && (
                              <>
                                {' '}
                                <a
                                  href={info.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  style={{ fontSize: '0.75rem' }}
                                >
                                  [link]
                                </a>
                              </>
                            )}
                            <br />
                            <a
                              href={`https://polygonscan.com/address/${agent.address}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="address"
                            >
                              {truncAddr(agent.address)}
                            </a>
                          </span>
                        ) : (
                          <a
                            href={`https://polygonscan.com/address/${agent.address}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="address"
                          >
                            {truncAddr(agent.address)}
                          </a>
                        )}
                      </td>
                      <td>
                        <span
                          className={`badge ${agent.revealed ? 'success' : 'warning'}`}
                        >
                          {agent.revealed ? 'Revealed' : 'Committed'}
                        </span>
                      </td>
                      <td className="mono" style={{ maxWidth: 400 }}>
                        {agent.predictions.length > 0
                          ? agent.predictions.map((p, i) => {
                              const outcome = round.outcomes?.[i];
                              let color = 'var(--text-primary)';
                              if (outcome === 'YES') {
                                color = p >= 5000 ? '#4ade80' : '#f87171'; // green if predicted up, red if predicted down
                              } else if (outcome === 'NO') {
                                color = p <= 5000 ? '#4ade80' : '#f87171'; // green if predicted down, red if predicted up
                              }
                              return (
                                <span key={i}>
                                  {i > 0 && ', '}
                                  <span style={{ color }}>{formatPct(p)}</span>
                                </span>
                              );
                            })
                          : '--'}
                      </td>
                      <td className="mono">{agent.brierScore ? formatBrier(agent.brierScore) : '--'}</td>
                      <td className="mono">{agent.alphaScore != null && agent.scoredMarkets > 0 ? formatAlpha(agent.alphaScore) : '--'}</td>
                      <td>{agent.scoredMarkets ?? '--'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
