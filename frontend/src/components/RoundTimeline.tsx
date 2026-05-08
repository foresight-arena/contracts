import { useState, useMemo, type CSSProperties, type ReactElement } from 'react';
import type { Round } from '../types';

interface TimelineEvent {
  time: number;
  label: string;
  type: 'milestone' | 'commit' | 'reveal' | 'now';
  color: string;
  detail?: string;
}

function shortTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function truncAddr(addr: string): string {
  return addr.slice(0, 6) + '...' + addr.slice(-4);
}

const COLORS = {
  created: '#6366f1',
  commitDeadline: '#f59e0b',
  revealStart: '#10b981',
  revealDeadline: '#ef4444',
  commit: '#3b82f6',
  now: '#e94560',
  reveal: '#22d3ee',       // cyan
  resolved: '#10b981',    // green (market resolution)
  triggered: '#a855f7',
};

export default function RoundTimeline({ round, agentNames }: {
  round: Round;
  agentNames: Map<string, string>;
}) {
  const [hovered, setHovered] = useState<number | null>(null);

  const { milestones, commits, reveals, nowEvent } = useMemo(() => {
    const ms: TimelineEvent[] = [];
    const cs: TimelineEvent[] = [];
    const rs: TimelineEvent[] = [];

    if (round.createdAt) {
      ms.push({ time: round.createdAt, label: 'Round created', type: 'milestone', color: COLORS.created });
    }

    for (const [addr, agent] of round.agents) {
      const name = agentNames.get(addr) || truncAddr(addr);
      if (agent.commitTimestamp) {
        cs.push({ time: agent.commitTimestamp, label: name, type: 'commit', color: COLORS.commit, detail: 'committed' });
      }
      if (agent.revealTimestamp) {
        rs.push({ time: agent.revealTimestamp, label: name, type: 'reveal', color: COLORS.reveal, detail: 'revealed' });
      }
    }

    ms.push({ time: round.commitDeadline, label: 'Commit deadline', type: 'milestone', color: COLORS.commitDeadline });
    ms.push({ time: round.revealStart, label: 'Reveal start', type: 'milestone', color: COLORS.revealStart });
    ms.push({ time: round.revealDeadline, label: 'Reveal deadline', type: 'milestone', color: COLORS.revealDeadline });

    // Market resolutions
    for (let i = 0; i < (round.marketResolutions || []).length; i++) {
      const mr = round.marketResolutions[i];
      if (mr.resolvedAt && mr.outcome) {
        ms.push({
          time: mr.resolvedAt,
          label: `Market ${i + 1} resolved ${mr.outcome}`,
          type: 'milestone',
          color: COLORS.resolved,
        });
      }
    }

    if (round.outcomesTriggered && round.outcomesTriggeredAt) {
      ms.push({ time: round.outcomesTriggeredAt, label: 'Outcomes triggered', type: 'milestone', color: COLORS.triggered });
    }

    let nw: TimelineEvent | null = null;
    const all = [...ms, ...cs, ...rs];
    const now = Math.floor(Date.now() / 1000);
    if (all.length > 0) {
      const start = Math.min(...all.map(e => e.time));
      const end = Math.max(...all.map(e => e.time));
      if (now >= start && now <= end + (end - start) * 0.1) {
        nw = { time: now, label: 'Now', type: 'now', color: COLORS.now };
      }
    }

    return {
      milestones: ms.sort((a, b) => a.time - b.time),
      commits: cs.sort((a, b) => a.time - b.time),
      reveals: rs.sort((a, b) => a.time - b.time),
      nowEvent: nw,
    };
  }, [round, agentNames]);

  const allEvents = useMemo(() => {
    const all = [...milestones, ...commits, ...reveals];
    if (nowEvent) all.push(nowEvent);
    return all;
  }, [milestones, commits, reveals, nowEvent]);

  if (allEvents.length < 3) return null;

  const minTime = Math.min(...allEvents.map(e => e.time));
  const maxTime = Math.max(...allEvents.map(e => e.time));
  const range = maxTime - minTime || 1;
  const toPercent = (t: number) => ((t - minTime) / range) * 100;

  const commitStart = round.createdAt || minTime;
  const phases = [
    { start: commitStart, end: round.commitDeadline, color: 'rgba(59, 130, 246, 0.08)', label: 'Commit' },
    { start: round.commitDeadline, end: round.revealStart, color: 'rgba(245, 158, 11, 0.06)', label: 'Gap' },
    { start: round.revealStart, end: round.revealDeadline, color: 'rgba(16, 185, 129, 0.08)', label: 'Reveal' },
  ];

  // Cluster overlapping events into a single dot with count
  function clusterEvents(events: TimelineEvent[]) {
    const clusters: { time: number; count: number; events: TimelineEvent[] }[] = [];
    for (const e of events) {
      const pct = toPercent(e.time);
      const last = clusters[clusters.length - 1];
      if (last && Math.abs(toPercent(last.time) - pct) < 2) {
        last.count++;
        last.events.push(e);
      } else {
        clusters.push({ time: e.time, count: 1, events: [e] });
      }
    }
    return clusters;
  }

  const commitClusters = clusterEvents(commits);
  const revealClusters = clusterEvents(reveals);


  return (
    <div style={containerStyle}>
      <h2 style={{ marginBottom: 'var(--space-md)' }}>Timeline</h2>

      <div style={barContainerStyle}>
        {/* Phase backgrounds */}
        {phases.map((phase, i) => {
          const left = Math.max(0, toPercent(phase.start));
          const right = Math.min(100, toPercent(phase.end));
          if (right <= left) return null;
          return (
            <div key={`phase-${i}`} style={{
              position: 'absolute', left: `${left}%`, width: `${right - left}%`,
              top: 0, bottom: 0, backgroundColor: phase.color,
              borderRadius: i === 0 ? '6px 0 0 6px' : i === phases.length - 1 ? '0 6px 6px 0' : 0,
            }}>
              {(right - left) > 12 && (
                <span style={phaseLabelStyle}>{phase.label}</span>
              )}
            </div>
          );
        })}

        <div style={trackStyle} />

        {/* Day boundaries */}
        {(() => {
          const firstDay = new Date(minTime * 1000);
          firstDay.setHours(0, 0, 0, 0);
          let dayStart = Math.floor(firstDay.getTime() / 1000) + 86400; // start from next midnight
          const lines: ReactElement[] = [];
          while (dayStart < maxTime) {
            const pct = toPercent(dayStart);
            if (pct > 1 && pct < 99) {
              const dayLabel = new Date(dayStart * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
              lines.push(
                <div key={`day-${dayStart}`} style={{
                  position: 'absolute', left: `${pct}%`, top: 0, bottom: -16,
                  width: 1, backgroundColor: 'var(--border)', opacity: 0.5,
                  transform: 'translateX(-50%)', zIndex: 1,
                }}>
                  <span style={{
                    position: 'absolute', bottom: -14, left: '50%', transform: 'translateX(-50%)',
                    fontSize: '0.5625rem', color: 'var(--text-muted)', whiteSpace: 'nowrap',
                  }}>
                    {dayLabel}
                  </span>
                </div>
              );
            }
            dayStart += 86400;
          }
          return lines;
        })()}

        {/* Milestone markers */}
        {milestones.map((evt, i) => (
          <div
            key={`ms-${i}`}
            style={{ position: 'absolute', left: `${toPercent(evt.time)}%`, top: '25%', transform: 'translate(-50%, 0)', zIndex: 3, cursor: 'pointer' }}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
          >
            <div style={{
              width: 14, height: 14, borderRadius: '50%',
              backgroundColor: evt.color, border: '2px solid var(--bg-primary)',
              boxShadow: `0 0 0 1px ${evt.color}40`,
            }} />
            {hovered === i && (
              <div style={tooltipStyle}>
                <div style={{ fontWeight: 600, marginBottom: 2 }}>{evt.label}</div>
                <div style={{ fontFamily: 'var(--fa-font-mono)', fontSize: '0.625rem' }}>{shortTime(evt.time)}</div>
              </div>
            )}
          </div>
        ))}

        {/* Commit cluster markers */}
        {commitClusters.map((cluster, i) => {
          const idx = milestones.length + i;
          return (
            <div
              key={`cc-${i}`}
              style={{ position: 'absolute', left: `${toPercent(cluster.time)}%`, top: '35%', transform: 'translate(-50%, 0)', zIndex: 2, cursor: 'pointer' }}
              onMouseEnter={() => setHovered(idx)}
              onMouseLeave={() => setHovered(null)}
            >
              <div style={{
                width: cluster.count > 1 ? 16 : 10, height: cluster.count > 1 ? 16 : 10,
                borderRadius: '50%', backgroundColor: COLORS.commit,
                border: '2px solid var(--bg-primary)', boxShadow: `0 0 0 1px ${COLORS.commit}40`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '0.5rem', fontWeight: 700, color: '#fff',
              }}>
                {cluster.count > 1 ? cluster.count : ''}
              </div>
              {hovered === idx && (
                <div style={tooltipStyle}>
                  <div style={{ fontWeight: 600, marginBottom: 2 }}>
                    {cluster.count} commit{cluster.count > 1 ? 's' : ''}
                  </div>
                  {cluster.events.map((e, j) => (
                    <div key={j} style={{ fontSize: '0.625rem', color: 'var(--text-secondary)' }}>
                      {e.label} -- {shortTime(e.time)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {/* Reveal cluster markers */}
        {revealClusters.map((cluster, i) => {
          const idx = milestones.length + commitClusters.length + i;
          return (
            <div
              key={`rc-${i}`}
              style={{ position: 'absolute', left: `${toPercent(cluster.time)}%`, top: '15%', transform: 'translate(-50%, 0)', zIndex: 2, cursor: 'pointer' }}
              onMouseEnter={() => setHovered(idx)}
              onMouseLeave={() => setHovered(null)}
            >
              <div style={{
                width: cluster.count > 1 ? 16 : 10, height: cluster.count > 1 ? 16 : 10,
                borderRadius: '50%', backgroundColor: COLORS.reveal,
                border: '2px solid var(--bg-primary)', boxShadow: `0 0 0 1px ${COLORS.reveal}40`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '0.5rem', fontWeight: 700, color: '#fff',
              }}>
                {cluster.count > 1 ? cluster.count : ''}
              </div>
              {hovered === idx && (
                <div style={tooltipStyle}>
                  <div style={{ fontWeight: 600, marginBottom: 2 }}>
                    {cluster.count} reveal{cluster.count > 1 ? 's' : ''}
                  </div>
                  {cluster.events.map((e, j) => (
                    <div key={j} style={{ fontSize: '0.625rem', color: 'var(--text-secondary)' }}>
                      {e.label} -- {shortTime(e.time)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {/* NOW line */}
        {nowEvent && (
          <div style={{ ...nowLineStyle, left: `${toPercent(nowEvent.time)}%` }}>
            <div style={nowLabelStyle}>NOW</div>
          </div>
        )}
      </div>

    </div>
  );
}

const containerStyle: CSSProperties = { marginBottom: 'var(--space-xl)' };

const barContainerStyle: CSSProperties = {
  position: 'relative', height: 48, marginBottom: 'var(--space-xl)', borderRadius: 6, overflow: 'visible',
};

const trackStyle: CSSProperties = {
  position: 'absolute', top: '50%', left: 0, right: 0, height: 2,
  backgroundColor: 'var(--border)', transform: 'translateY(-50%)',
};

const phaseLabelStyle: CSSProperties = {
  position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
  fontSize: '0.625rem', fontWeight: 600, textTransform: 'uppercase',
  letterSpacing: '0.08em', color: 'var(--text-muted)', whiteSpace: 'nowrap',
};

const nowLineStyle: CSSProperties = {
  position: 'absolute', top: 0, bottom: -4, width: 2,
  backgroundColor: COLORS.now, transform: 'translateX(-50%)', zIndex: 4,
};

const nowLabelStyle: CSSProperties = {
  position: 'absolute', top: -18, left: '50%', transform: 'translateX(-50%)',
  fontSize: '0.5625rem', fontWeight: 700, color: COLORS.now, letterSpacing: '0.05em',
};

const tooltipStyle: CSSProperties = {
  position: 'absolute', top: -8, left: '50%', transform: 'translate(-50%, -100%)',
  backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)', padding: '6px 10px', fontSize: '0.6875rem',
  color: 'var(--text-primary)', whiteSpace: 'nowrap', zIndex: 10,
  boxShadow: '0 4px 12px rgba(0,0,0,0.3)', pointerEvents: 'none',
};

