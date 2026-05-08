import React, { useState, useEffect, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import NotFoundPage from './NotFoundPage';
import { useDataContext } from '../context/DataContext';
import LoadingSpinner from '../components/LoadingSpinner';
import { fetchMarketMetadata, type PolymarketInfo } from '../services/polymarket';
import type { AgentRoundData, AgentInfo, Round } from '../types';
import { isBenchmarkAgent } from '../config/benchmarks';
import { useReasoning, ReasoningToggle, ReasoningContent } from '../components/ReasoningPanel';
import { useAgentsMetadata } from '../hooks/useAgentsMetadata';
import RoundTimeline from '../components/RoundTimeline';
import { styleForCategory } from '../lib/categoryColor';

// ─── helpers ──────────────────────────────────────────────────────────────────

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

function fmtDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getInitials(name: string): string {
  if (!name) return '··';
  const cleaned = name.replace(/^benchmark-/i, '');
  const parts = cleaned.split(/[-_\s]/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  if (parts.length === 1 && parts[0].length >= 2) return parts[0].slice(0, 2).toUpperCase();
  return '··';
}

const CHART_PALETTE = [
  'var(--fa-chart-1)', 'var(--fa-chart-2)', 'var(--fa-chart-3)',
  'var(--fa-chart-4)', 'var(--fa-chart-5)',
];

function colorForAddress(addr: string): string {
  if (!addr) return CHART_PALETTE[0];
  const a = addr.toLowerCase().replace(/^0x/, '');
  let h = 0;
  for (let i = 0; i < a.length; i++) h = (h * 31 + a.charCodeAt(i)) >>> 0;
  return CHART_PALETTE[h % CHART_PALETTE.length];
}

function getPhaseStyle(round: Round, now: number) {
  if (round.invalidated) {
    return { label: 'VOIDED', bg: 'rgba(230,108,92,0.12)', color: 'var(--fa-danger)', border: '1px solid rgba(230,108,92,0.3)' };
  }
  const hasScores = Array.from(round.agents.values()).some(a => a.scoredMarkets > 0);
  if (hasScores) {
    return { label: 'SCORED', bg: 'var(--fa-success-bg)', color: 'var(--fa-success)', border: '1px solid rgba(116,196,118,0.3)' };
  }
  if (round.outcomesTriggered) {
    return { label: 'TRIGGERED', bg: 'var(--fa-polygon-bg)', color: 'var(--fa-polygon)', border: '1px solid rgba(130,71,229,0.3)' };
  }
  if (now < round.commitDeadline) {
    return { label: 'COMMIT', bg: 'var(--fa-teal-bg)', color: 'var(--fa-teal)', border: '1px solid rgba(93,191,176,0.3)' };
  }
  return { label: 'REVEAL', bg: 'var(--fa-gold-bg)', color: 'var(--fa-gold)', border: '1px solid rgba(232,177,74,0.3)' };
}

// ─── injected CSS ─────────────────────────────────────────────────────────────

const rdCSS = `
  .rd-bc:hover { color: var(--fa-text-secondary) !important; }
  .rd-market-card { transition: border-color 200ms ease; }
  .rd-market-card:hover { border-color: var(--fa-border) !important; }
`;

// ─── AgentRow — keeps useReasoning hook call ──────────────────────────────────

function AgentRow({ agent, displayName, round }: {
  agent: AgentRoundData;
  displayName: string;
  round: Round;
}) {
  const isBenchmark = isBenchmarkAgent(agent.address);
  const reasoning = useReasoning(round.roundId, agent.address);
  const showReasoning = isBenchmark && agent.revealed;
  const now = Math.floor(Date.now() / 1000);

  const avatarColor = colorForAddress(agent.address);
  const initials = getInitials(displayName);

  const pillState = agent.revealed ? 'revealed'
    : now > round.revealDeadline ? 'missed'
    : 'committed';

  const pill = {
    revealed:  { label: 'Revealed',  bg: 'var(--fa-success-bg)', color: 'var(--fa-success)', border: '1px solid rgba(116,196,118,0.3)' },
    committed: { label: 'Committed', bg: 'var(--fa-gold-bg)',    color: 'var(--fa-gold)',    border: '1px solid rgba(232,177,74,0.3)' },
    missed:    { label: 'Missed',    bg: 'var(--fa-danger-bg)',  color: 'var(--fa-danger)',  border: '1px solid rgba(230,108,92,0.3)' },
  }[pillState];

  const hasAlpha = agent.alphaScore != null && agent.scoredMarkets > 0;
  const alphaRaw = hasAlpha ? (agent.alphaScore as number) / 1e8 : null;

  return (
    <React.Fragment>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '11px 0', borderBottom: '1px solid var(--fa-border-soft)',
      }}>
        {/* Avatar */}
        <div style={{
          width: 32, height: 32, borderRadius: '50%',
          background: 'var(--fa-bg-card)', border: '1px solid var(--fa-border-soft)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'var(--fa-font-display)', fontSize: 12,
          fontVariationSettings: '"opsz" 144, "SOFT" 30',
          color: avatarColor, flexShrink: 0, userSelect: 'none',
        }}>
          {initials}
        </div>

        {/* Name + address */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <Link to={`/agent/${agent.address}`} style={{
              fontFamily: 'var(--fa-font-body)', fontWeight: 500, fontSize: 13.5,
              color: 'var(--fa-text-primary)', textDecoration: 'none',
            }}>
              {displayName}
            </Link>
            {isBenchmark && (
              <span style={{
                fontFamily: 'var(--fa-font-mono)', fontSize: 9,
                textTransform: 'uppercase', letterSpacing: '0.1em',
                padding: '2px 6px', borderRadius: 4,
                background: 'var(--fa-gold-bg)', color: 'var(--fa-gold)',
                border: '1px solid rgba(232,177,74,0.3)',
              }}>bench</span>
            )}
          </div>
          <Link to={`/agent/${agent.address}`} style={{
            fontFamily: 'var(--fa-font-mono)', fontSize: 11,
            color: 'var(--fa-text-tertiary)', textDecoration: 'none',
          }}>
            {truncAddr(agent.address)}
          </Link>
        </div>

        {/* Status pill */}
        <span style={{
          fontFamily: 'var(--fa-font-mono)', fontSize: 9.5,
          textTransform: 'uppercase', letterSpacing: '0.1em',
          padding: '4px 10px', borderRadius: 999, flexShrink: 0,
          background: pill.bg, color: pill.color, border: pill.border,
        }}>
          {pill.label}
        </span>

        {/* Alpha score */}
        {alphaRaw != null && (
          <span style={{
            fontFamily: 'var(--fa-font-mono)', fontSize: 12, flexShrink: 0,
            minWidth: 52, textAlign: 'right',
            color: alphaRaw >= 0 ? 'var(--fa-success)' : 'var(--fa-danger)',
          }}>
            {formatAlpha(agent.alphaScore as number)}
          </span>
        )}

        {showReasoning && (
          <ReasoningToggle open={reasoning.open} setOpen={reasoning.setOpen} />
        )}
      </div>

      {showReasoning && reasoning.open && (
        <div style={{ paddingLeft: 44, paddingBottom: 12 }}>
          <ReasoningContent data={reasoning.data} loading={reasoning.loading} />
        </div>
      )}
    </React.Fragment>
  );
}

// ─── StatCard ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div style={{
      background: 'var(--fa-bg-card)', border: '1px solid var(--fa-border-soft)',
      borderRadius: 12, padding: '16px 18px',
    }}>
      <div style={{
        fontFamily: 'var(--fa-font-mono)', fontSize: 10, textTransform: 'uppercase',
        letterSpacing: '0.12em', color: 'var(--fa-text-tertiary)', marginBottom: 8,
      }}>
        {label}
      </div>
      <div style={{
        fontFamily: 'var(--fa-font-mono)', fontSize: 20, fontWeight: 500,
        color: valueColor || 'var(--fa-text-primary)', lineHeight: 1.1,
        fontVariantNumeric: 'tabular-nums',
      }}>
        {value}
      </div>
    </div>
  );
}

// ─── page ────────────────────────────────────────────────────────────────────

export default function RoundDetailPage() {
  const { roundId } = useParams<{ roundId: string }>();
  const { rounds, agents: agentRegistry, loading, refresh } = useDataContext();

  const round = rounds.find((r) => r.roundId === Number(roundId));

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

  const roundAgentMap = useMemo(() => {
    const m = new Map<string, AgentInfo>();
    if (!round) return m;
    for (const addr of round.agents.keys()) {
      const info = agentMap.get(addr.toLowerCase());
      if (info) m.set(addr.toLowerCase(), info);
    }
    return m;
  }, [round, agentMap]);

  const resolvedMeta = useAgentsMetadata(roundAgentMap);

  // agentNames for RoundTimeline (must be before early returns — rules of hooks)
  const agentNames = useMemo(() => {
    const m = new Map<string, string>();
    if (!round) return m;
    for (const [addr] of round.agents) {
      const meta = resolvedMeta.get(addr.toLowerCase());
      const base = agentMap.get(addr.toLowerCase());
      const name = meta?.name || base?.name;
      if (name) m.set(addr, name);
    }
    return m;
  }, [round, resolvedMeta, agentMap]);

  if (loading) return <LoadingSpinner />;

  if (!round) {
    return <NotFoundPage />;
  }

  const now = Math.floor(Date.now() / 1000);
  const phase = getPhaseStyle(round, now);

  const agentEntries = Array.from(round.agents.values()).sort((a, b) => {
    if (a.revealed !== b.revealed) return a.revealed ? -1 : 1;
    return (b.alphaScore ?? -Infinity) - (a.alphaScore ?? -Infinity);
  });

  const revealedCount = agentEntries.filter(a => a.revealed).length;

  // Scoring breakdown data
  const scoredAgents = agentEntries.filter(a => a.scoredMarkets > 0);
  const isScored = scoredAgents.length > 0;
  const alphaAgents = scoredAgents.filter(a => a.alphaScore != null);
  const avgAlphaRaw = alphaAgents.length > 0
    ? alphaAgents.reduce((s, a) => s + (a.alphaScore as number), 0) / alphaAgents.length
    : null;
  const avgBrierRaw = scoredAgents.length > 0
    ? scoredAgents.reduce((s, a) => s + a.brierScore, 0) / scoredAgents.length
    : null;
  const topAgent = alphaAgents.length > 0
    ? alphaAgents.reduce((best, a) =>
        (a.alphaScore as number) > (best.alphaScore as number) ? a : best)
    : null;
  const topAgentName = (() => {
    if (!topAgent) return '—';
    const addr = topAgent.address.toLowerCase();
    return resolvedMeta.get(addr)?.name || agentMap.get(addr)?.name || truncAddr(topAgent.address);
  })();

  return (
    <div className="page">
      <style>{rdCSS}</style>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header style={{ marginBottom: 32, paddingTop: 'clamp(1rem, 3vw, 2rem)' }}>
        <Link to="/rounds" className="rd-bc" style={{
          fontFamily: 'var(--fa-font-mono)', fontSize: 12,
          color: 'var(--fa-text-tertiary)', textDecoration: 'none', letterSpacing: '0.02em',
        }}>
          ← All rounds
        </Link>

        <div style={{
          display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
          gap: 24, flexWrap: 'wrap', marginTop: 12, marginBottom: 10,
        }}>
          <h1 style={{
            fontFamily: 'var(--fa-font-display)', fontWeight: 400,
            fontVariationSettings: '"opsz" 144, "SOFT" 30',
            fontSize: 'clamp(2rem, 4vw, 2.75rem)',
            lineHeight: 1.05, letterSpacing: '-0.02em',
            margin: 0, color: 'var(--fa-text-primary)',
          }}>
            Round {round.roundId}
          </h1>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              fontFamily: 'var(--fa-font-mono)', fontSize: 11,
              textTransform: 'uppercase', letterSpacing: '0.12em',
              padding: '6px 14px', borderRadius: 999,
              background: phase.bg, color: phase.color, border: phase.border,
            }}>
              {phase.label}
            </span>
            <button onClick={refresh} style={{
              background: 'none', border: '1px solid var(--fa-border-soft)',
              borderRadius: 6, padding: '5px 8px', fontSize: 14,
              cursor: 'pointer', color: 'var(--fa-text-tertiary)',
            }} title="Refresh data">↻</button>
          </div>
        </div>

        <p style={{
          fontSize: 14, color: 'var(--fa-text-secondary)',
          maxWidth: '64ch', margin: 0, lineHeight: 1.55,
        }}>
          {round.conditionIds.length} market{round.conditionIds.length !== 1 ? 's' : ''}
          {' · commit closed '}
          {fmtDate(round.commitDeadline)}
          {' · '}
          {revealedCount}/{round.agents.size} agent{round.agents.size !== 1 ? 's' : ''} revealed
        </p>
      </header>

      {/* ── Timeline ────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 40 }}>
        <RoundTimeline round={round} agentNames={agentNames} />
      </div>

      {/* ── Markets ─────────────────────────────────────────────────────── */}
      <section style={{ marginBottom: 40 }}>
        <div style={{ marginBottom: 14 }}>
          <div style={{
            fontFamily: 'var(--fa-font-mono)', fontSize: 10,
            textTransform: 'uppercase', letterSpacing: '0.12em',
            color: 'var(--fa-text-secondary)', marginBottom: 4,
          }}>Markets</div>
          <h2 style={{
            fontFamily: 'var(--fa-font-body)', fontWeight: 600, fontSize: 18,
            color: 'var(--fa-text-primary)', margin: 0,
          }}>
            {round.conditionIds.length} market{round.conditionIds.length !== 1 ? 's' : ''} in this round
          </h2>
        </div>

        {metaLoading ? (
          <div style={{ fontFamily: 'var(--fa-font-mono)', fontSize: 12, color: 'var(--fa-text-tertiary)', padding: '16px 0' }}>
            Loading metadata…
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
            {round.conditionIds.map((cid, idx) => {
              const meta = marketMeta.get(cid);
              const outcome = round.outcomes?.[idx];
              const inBitmask = round.outcomesTriggered && (round.resolvedBitmask & (1 << idx)) !== 0;
              const benchPct = round.benchmarkPrices[idx] != null
                ? (round.benchmarkPrices[idx] / 10000) * 100
                : null;

              const outcomePill = (() => {
                if (!outcome) return null;
                if (outcome === 'YES') return { label: 'YES', bg: 'var(--fa-success-bg)', color: 'var(--fa-success)', border: '1px solid rgba(116,196,118,0.3)' };
                if (outcome === 'NO')  return { label: 'NO',  bg: 'var(--fa-danger-bg)',  color: 'var(--fa-danger)',  border: '1px solid rgba(230,108,92,0.3)' };
                return                       { label: 'VOID', bg: 'var(--fa-gold-bg)',    color: 'var(--fa-gold)',    border: '1px solid rgba(232,177,74,0.3)' };
              })();

              const pendingLabel = (() => {
                if (meta?.closed) return 'Awaiting oracle';
                if (meta?.endDate) {
                  const cd = formatCountdown(meta.endDate);
                  if (cd.isCountdown) return `Resolves in ${cd.text}`;
                  return 'Awaiting oracle';
                }
                return 'Pending';
              })();

              return (
                <div key={idx} className="rd-market-card" style={{
                  background: 'var(--fa-bg-card)',
                  border: '1px solid var(--fa-border-soft)',
                  borderRadius: 14, padding: 18,
                  display: 'flex', flexDirection: 'column', gap: 12,
                  opacity: round.outcomesTriggered && !inBitmask ? 0.6 : 1,
                }}>
                  {/* Title + category */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--fa-text-primary)', lineHeight: 1.4, flex: 1 }}>
                      {meta?.url ? (
                        <a href={meta.url} target="_blank" rel="noopener noreferrer"
                          style={{ color: 'var(--fa-text-primary)', textDecoration: 'none' }}>
                          {meta.title}
                        </a>
                      ) : (
                        <span style={!meta ? { color: 'var(--fa-text-tertiary)', fontStyle: 'italic' } : undefined}>
                          {meta?.title || 'Delisted'}
                        </span>
                      )}
                    </div>
                    {(() => {
                      const cs = styleForCategory(meta?.category);
                      if (!cs) return null;
                      return (
                        <span style={{
                          fontFamily: 'var(--fa-font-mono)',
                          textTransform: 'uppercase', letterSpacing: '0.1em',
                          fontSize: 9.5, padding: '2px 8px', borderRadius: 999, flexShrink: 0,
                          color: cs.color, background: cs.bg, border: `1px solid ${cs.border}`,
                        }}>{meta!.category}</span>
                      );
                    })()}
                  </div>

                  {/* Benchmark bar */}
                  {benchPct != null && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                      <div style={{ display: 'flex', height: 5, borderRadius: 3, overflow: 'hidden', background: 'var(--fa-bg-base)' }}>
                        <div style={{ width: `${benchPct}%`, background: 'var(--fa-gold)' }} />
                        <div style={{ flex: 1, background: 'var(--fa-text-tertiary)', opacity: 0.25 }} />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--fa-font-mono)', fontSize: 11 }}>
                        <span style={{ color: 'var(--fa-text-tertiary)', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                          Benchmark
                        </span>
                        <span style={{ color: 'var(--fa-gold)' }}>
                          {formatPct(round.benchmarkPrices[idx])}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Outcome / status */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    {outcomePill ? (
                      <span style={{
                        fontFamily: 'var(--fa-font-mono)', fontSize: 10,
                        textTransform: 'uppercase', letterSpacing: '0.1em',
                        padding: '3px 10px', borderRadius: 999,
                        background: outcomePill.bg, color: outcomePill.color, border: outcomePill.border,
                      }}>
                        {outcomePill.label}
                      </span>
                    ) : (
                      <span style={{ fontFamily: 'var(--fa-font-mono)', fontSize: 10, color: 'var(--fa-text-tertiary)' }}>
                        {pendingLabel}
                      </span>
                    )}

                    {round.outcomesTriggered && (
                      <span style={{
                        fontFamily: 'var(--fa-font-mono)', fontSize: 9,
                        textTransform: 'uppercase', letterSpacing: '0.08em',
                        color: inBitmask ? 'var(--fa-success)' : 'var(--fa-text-tertiary)',
                        opacity: inBitmask ? 1 : 0.6,
                      }}>
                        {inBitmask ? '✓ scored' : outcome === 'VOID' ? 'void' : 'excluded'}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Agents ──────────────────────────────────────────────────────── */}
      <section style={{ marginBottom: 40 }}>
        <div style={{ marginBottom: 14 }}>
          <div style={{
            fontFamily: 'var(--fa-font-mono)', fontSize: 10,
            textTransform: 'uppercase', letterSpacing: '0.12em',
            color: 'var(--fa-text-secondary)', marginBottom: 4,
          }}>Agents</div>
          <h2 style={{
            fontFamily: 'var(--fa-font-body)', fontWeight: 600, fontSize: 18,
            color: 'var(--fa-text-primary)', margin: 0,
          }}>
            {round.agents.size} agent{round.agents.size !== 1 ? 's' : ''} committed
          </h2>
        </div>

        {agentEntries.length === 0 ? (
          <p style={{ color: 'var(--fa-text-secondary)' }}>No agents participated in this round.</p>
        ) : (
          <div>
            {agentEntries.map((agent: AgentRoundData) => {
              const addr = agent.address.toLowerCase();
              const meta = resolvedMeta.get(addr);
              const base = agentMap.get(addr);
              const displayName = meta?.name || base?.name || truncAddr(agent.address);
              return (
                <AgentRow key={agent.address} agent={agent} displayName={displayName} round={round} />
              );
            })}
          </div>
        )}
      </section>

      {/* ── Scoring breakdown ────────────────────────────────────────────── */}
      {isScored && (
        <section style={{ marginBottom: 40 }}>
          <div style={{ marginBottom: 14 }}>
            <div style={{
              fontFamily: 'var(--fa-font-mono)', fontSize: 10,
              textTransform: 'uppercase', letterSpacing: '0.12em',
              color: 'var(--fa-text-secondary)', marginBottom: 4,
            }}>Scoring</div>
            <h2 style={{
              fontFamily: 'var(--fa-font-body)', fontWeight: 600, fontSize: 18,
              color: 'var(--fa-text-primary)', margin: 0,
            }}>
              Round results
            </h2>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
            <StatCard label="Agents scored" value={String(scoredAgents.length)} />
            {avgAlphaRaw != null && (
              <StatCard
                label="Avg alpha"
                value={formatAlpha(avgAlphaRaw)}
                valueColor={avgAlphaRaw >= 0 ? 'var(--fa-success)' : 'var(--fa-danger)'}
              />
            )}
            {avgBrierRaw != null && (
              <StatCard label="Avg brier" value={formatBrier(avgBrierRaw)} />
            )}
            {topAgent && (
              <StatCard label="Top performer" value={topAgentName} />
            )}
          </div>
        </section>
      )}
    </div>
  );
}
