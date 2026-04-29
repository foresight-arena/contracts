import React, { useState, useEffect, useMemo, type CSSProperties } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useDataContext } from '../context/DataContext';
import StatusBadge from '../components/StatusBadge';
import LoadingSpinner from '../components/LoadingSpinner';
import { fetchMarketMetadata, type PolymarketInfo } from '../services/polymarket';
import type { AgentRoundData, AgentInfo, Round } from '../types';
import { isBenchmarkAgent } from '../config/benchmarks';
import { useReasoning, ReasoningToggle, ReasoningContent } from '../components/ReasoningPanel';
import { useAgentsMetadata } from '../hooks/useAgentsMetadata';
import RoundTimeline from '../components/RoundTimeline';

function formatCountdown(endDate: string | null): { text: string; isCountdown: boolean } {
  if (!endDate) return { text: '--', isCountdown: false };
  const end = new Date(endDate).getTime();
  const now = Date.now();
  const diff = end - now;
  if (diff <= 0) return { text: 'Closed', isCountdown: false };
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h > 24) return { text: `${Math.floor(h / 24)}d ${h % 24}h`, isCountdown: true };
  if (h > 0) return { text: `${h}h ${m}m`, isCountdown: true };
  return { text: `${m}m`, isCountdown: true };
}

function truncAddr(addr: string): string {
  return addr.slice(0, 6) + '...' + addr.slice(-4);
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


function AgentRow({ agent, info, round }: { agent: AgentRoundData; info?: AgentInfo; round: Round }) {
  const isBenchmark = isBenchmarkAgent(agent.address);
  const reasoning = useReasoning(round.roundId, agent.address);
  const showReasoning = isBenchmark && agent.revealed;

  return (
    <React.Fragment>
      <tr className={isBenchmark ? 'benchmark-row' : undefined}>
        <td>
          {info?.name ? (
            <span>
              <Link to={`/agent/${agent.address}`} style={{ fontWeight: 600, color: 'var(--text-primary)', textDecoration: 'none' }}>{info.name}</Link>
              {isBenchmark && (
                <>
                  {' '}
                  <span className="badge benchmark" title="Benchmark agent">benchmark</span>
                </>
              )}
              <br />
              <Link to={`/agent/${agent.address}`} className="address">
                {truncAddr(agent.address)}
              </Link>
            </span>
          ) : (
            <span>
              <Link to={`/agent/${agent.address}`} className="address">
                {truncAddr(agent.address)}
              </Link>
              {isBenchmark && (
                <>
                  {' '}
                  <span className="badge benchmark" title="Benchmark agent">benchmark</span>
                </>
              )}
            </span>
          )}
        </td>
        <td>
          {agent.revealed && agent.scoredMarkets === 0 && !round.outcomesTriggered ? (
            <span className="badge accent">Pending scoring</span>
          ) : (
            <span className={`badge ${agent.revealed ? 'success' : 'warning'}`}>
              {agent.revealed ? 'Revealed' : 'Committed'}
            </span>
          )}
        </td>
        <td className="mono" style={{ maxWidth: 400 }}>
          {agent.predictions.length > 0
            ? agent.predictions.map((p, i) => {
                const outcome = round.outcomes?.[i];
                let color = 'var(--text-primary)';
                if (outcome === 'YES') {
                  color = p >= 5000 ? '#4ade80' : '#f87171';
                } else if (outcome === 'NO') {
                  color = p <= 5000 ? '#4ade80' : '#f87171';
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
        <td>
          {agent.revealed ? agent.scoredMarkets : '--'}
          {showReasoning && (
            <>
              {' '}
              <ReasoningToggle open={reasoning.open} setOpen={reasoning.setOpen} />
            </>
          )}
        </td>
      </tr>
      {showReasoning && reasoning.open && (
        <tr className="benchmark-row">
          <td colSpan={6} style={{ padding: 'var(--space-xs) var(--space-md) var(--space-md)' }}>
            <ReasoningContent data={reasoning.data} loading={reasoning.loading} />
          </td>
        </tr>
      )}
    </React.Fragment>
  );
}

export default function RoundDetailPage() {
  const { roundId } = useParams<{ roundId: string }>();
  const { rounds, agents: agentRegistry, loading, refresh } = useDataContext();

  const round = rounds.find((r) => r.roundId === Number(roundId));

  // Fetch Polymarket metadata for this round's markets
  const [marketMeta, setMarketMeta] = useState<Map<string, PolymarketInfo>>(new Map());
  const [metaLoading, setMetaLoading] = useState(false);
  useEffect(() => {
    if (round) {
      setMetaLoading(true);
      fetchMarketMetadata(round.conditionIds)
        .then(setMarketMeta)
        .finally(() => setMetaLoading(false));
    }
  }, [round]);

  const agentMap = agentRegistry;
  // Only resolve metadata for agents that participated in THIS round
  const roundAgentMap = useMemo(() => {
    const m = new Map();
    if (!round) return m;
    for (const addr of round.agents.keys()) {
      const info = agentMap.get(addr.toLowerCase());
      if (info) m.set(addr.toLowerCase(), info);
    }
    return m;
  }, [round, agentMap]);
  const resolvedMeta = useAgentsMetadata(roundAgentMap);

  if (loading) return <LoadingSpinner />;

  if (!round) {
    return (
      <div className="page">
        <h1>Round not found</h1>
        <p>
          Round #{roundId} does not exist.{' '}
          <Link to="/arena">Back to Arena</Link>
        </p>
      </div>
    );
  }

  const agentEntries = Array.from(round.agents.values());

  return (
    <div className="page">
      <div style={{ marginBottom: 'var(--space-md)' }}>
        <Link to="/arena" style={{ fontSize: '0.875rem' }}>
          &larr; Back to Arena
        </Link>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', marginBottom: 'var(--space-lg)' }}>
        <h1 style={{ marginBottom: 0 }}>Round #{round.roundId}</h1>
        <StatusBadge round={round} />
        <button onClick={refresh} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '4px 10px', fontSize: '1rem', cursor: 'pointer', color: 'var(--text-secondary)' }} title="Refresh data">↻</button>
      </div>


      {/* Timeline */}
      <RoundTimeline
        round={round}
        agentNames={(() => {
          const names = new Map<string, string>();
          for (const [addr] of round.agents) {
            const meta = resolvedMeta.get(addr);
            const base = agentMap.get(addr);
            const name = meta?.name || base?.name;
            if (name) names.set(addr, name);
          }
          return names;
        })()}
      />

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
                {round.outcomesTriggered && <th>Scored</th>}
              </tr>
            </thead>
            <tbody>
              {round.conditionIds.map((cid, idx) => {
                const meta = marketMeta.get(cid);
                const outcome = round.outcomes?.[idx];
                const inBitmask = round.outcomesTriggered && (round.resolvedBitmask & (1 << idx)) !== 0;
                return (
                  <tr key={idx} style={round.outcomesTriggered && !inBitmask ? { opacity: 0.5 } : undefined}>
                    <td>{idx + 1}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 2 }}>
                        {meta?.category && (
                          <span style={{
                            fontSize: '0.5625rem',
                            fontWeight: 600,
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em',
                            padding: '2px 6px',
                            borderRadius: '100px',
                            backgroundColor: {
                              crypto: 'rgba(59, 130, 246, 0.12)',
                              sports: 'rgba(16, 185, 129, 0.12)',
                              politics: 'rgba(168, 85, 247, 0.12)',
                              science: 'rgba(245, 158, 11, 0.12)',
                              entertainment: 'rgba(236, 72, 153, 0.12)',
                              weather: 'rgba(56, 189, 248, 0.12)',
                              other: 'var(--bg-tertiary)',
                            }[meta.category],
                            color: {
                              crypto: 'var(--accent)',
                              sports: 'var(--success)',
                              politics: '#a855f7',
                              science: 'var(--warning)',
                              entertainment: '#ec4899',
                              weather: '#38bdf8',
                              other: 'var(--text-muted)',
                            }[meta.category],
                          }}>
                            {meta.category}
                          </span>
                        )}
                        {meta?.url ? (
                          <a href={meta.url} target="_blank" rel="noopener noreferrer">
                            {meta.title}
                          </a>
                        ) : (
                          <span style={!meta && !metaLoading ? { color: 'var(--text-muted)', fontStyle: 'italic' } : undefined}>
                            {meta?.title || (metaLoading ? '...' : 'Delisted')}
                          </span>
                        )}
                      </div>
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
                      {(() => {
                        if (outcome) return (
                          <span className={`badge ${outcome === 'YES' ? 'success' : 'error'}`} title="Oracle has posted the outcome on-chain">
                            {outcome}
                          </span>
                        );
                        if (meta?.closed) return <span className="badge warning" style={{ cursor: 'help' }} title="Market closed on Polymarket, waiting for the oracle to post the result on-chain">Awaiting oracle</span>;
                        if (meta?.endDate) {
                          const cd = formatCountdown(meta.endDate);
                          if (cd.isCountdown) return <span className="badge warning" style={{ cursor: 'help' }} title={`Market closes around ${new Date(meta.endDate).toLocaleString()}`}>Resolves in {cd.text}</span>;
                          return <span className="badge warning" style={{ cursor: 'help' }} title="Market close time has passed, waiting for oracle resolution">Awaiting oracle</span>;
                        }
                        return <span className="badge" style={{ cursor: 'help' }} title="Resolution time unknown">Pending</span>;
                      })()}
                    </td>
                    {round.outcomesTriggered && (
                      <td>
                        {inBitmask ? (
                          <span className="badge success" style={{ cursor: 'help' }} title="Included in scoring bitmask">Scored</span>
                        ) : outcome === 'VOID' ? (
                          <span className="badge warning" style={{ cursor: 'help' }} title="Market resolved as void (50/50 split) -- excluded from scoring">Void (50/50)</span>
                        ) : outcome ? (
                          <span className="badge warning" style={{ cursor: 'help' }} title="Market resolved after outcomes were triggered -- excluded from scoring">Late resolution</span>
                        ) : (
                          <span className="badge" style={{ cursor: 'help' }} title="Market was not resolved when outcomes were triggered -- excluded from scoring">Not resolved</span>
                        )}
                      </td>
                    )}
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
                  const addr = agent.address.toLowerCase();
                  const baseInfo = agentMap.get(addr);
                  const meta = resolvedMeta.get(addr);
                  const info = baseInfo
                    ? { ...baseInfo, name: meta?.name || baseInfo.name, url: meta?.url || baseInfo.url }
                    : undefined;
                  return (
                    <AgentRow
                      key={agent.address}
                      agent={agent}
                      info={info}
                      round={round}
                    />
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
