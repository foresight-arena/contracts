import { useMemo, type CSSProperties } from 'react';
import type { Round } from '../types';
import { buildPhaseSteps, formatPhaseTimestamp, type PhaseStep } from '../lib/roundPhase';

// ─── Voided layout (invalidated rounds) ──────────────────────────────────────

function fmtDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function VoidedTimeline({ round }: { round: Round }) {
  const phases = [
    { label: 'Commit',    sub: fmtDate(round.commitDeadline) },
    { label: 'Reveal',    sub: fmtDate(round.revealDeadline) },
    { label: 'Triggered', sub: '—' },
    { label: 'Scored',    sub: '—' },
    { label: 'Voided',    sub: '—', terminal: true },
  ];

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start' }}>
      {phases.map((ph, i) => {
        const isFirst = i === 0;
        const isLast = i === phases.length - 1;
        return (
          <div key={ph.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}>
            {!isFirst && (
              <div style={{ position: 'absolute', top: 9, left: 0, right: '50%', height: 1.5, borderTop: '1.5px solid var(--fa-border-soft)', opacity: 0.3 }} />
            )}
            {!isLast && (
              <div style={{ position: 'absolute', top: 9, left: '50%', right: 0, height: 1.5, borderTop: '1.5px solid var(--fa-border-soft)', opacity: 0.3 }} />
            )}
            <div style={{
              width: 20, height: 20, borderRadius: '50%', zIndex: 1, boxSizing: 'border-box',
              background: ph.terminal ? 'var(--fa-danger)' : 'transparent',
              border: ph.terminal ? 'none' : '1.5px solid var(--fa-border-soft)',
              opacity: ph.terminal ? 1 : 0.35,
            }} />
            <div style={{
              marginTop: 8, fontFamily: 'var(--fa-font-mono)', fontSize: 10,
              textTransform: 'uppercase', letterSpacing: '0.09em',
              color: ph.terminal ? 'var(--fa-danger)' : 'var(--fa-text-tertiary)',
              fontWeight: ph.terminal ? 600 : 400, opacity: ph.terminal ? 1 : 0.35,
            }}>
              {ph.label}
            </div>
            <div style={{ marginTop: 2, fontFamily: 'var(--fa-font-mono)', fontSize: 9, color: 'var(--fa-text-tertiary)', opacity: 0.4 }}>
              {ph.sub}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Connector helper ─────────────────────────────────────────────────────────

function connectorStyle(leftStep: PhaseStep, rightStep: PhaseStep): CSSProperties {
  const lDone  = leftStep.status === 'past';
  const lActive = leftStep.status === 'active';
  const rDone  = rightStep.status === 'past';
  const rActive = rightStep.status === 'active';

  const bothPast  = lDone && rDone;
  const toActive  = lDone && rActive;
  const fromActive = lActive && rDone; // anomaly case

  if (bothPast || fromActive) {
    return { position: 'absolute', top: 9, height: 1.5, borderTop: '1.5px solid var(--fa-text-tertiary)' };
  }
  if (toActive) {
    return { position: 'absolute', top: 9, height: 1.5, borderTop: '1.5px solid var(--fa-gold)' };
  }
  // future / pending
  return { position: 'absolute', top: 9, height: 1.5, borderTop: '1.5px dashed var(--fa-border-soft)' };
}

// ─── Step dot / label / sub helpers ──────────────────────────────────────────

function dotStyle(step: PhaseStep): CSSProperties {
  const { status, timestamp, anomaly } = step;
  const isActivePending = status === 'active' && timestamp === null;

  if (anomaly && status !== 'pending') {
    return { border: '2px dashed var(--fa-danger)', background: 'transparent' };
  }
  if (isActivePending) {
    return { border: '2px dotted var(--fa-gold)', background: 'transparent' };
  }
  if (status === 'active') {
    return { border: 'none', background: 'var(--fa-gold)' };
  }
  if (status === 'past') {
    return { border: 'none', background: 'var(--fa-text-tertiary)' };
  }
  // pending (non-active)
  return { border: '2px dotted var(--fa-border-soft)', background: 'transparent' };
}

function labelColor(step: PhaseStep): string {
  if (step.anomaly && step.status !== 'pending') return 'var(--fa-danger)';
  if (step.status === 'active') return 'var(--fa-gold)';
  return 'var(--fa-text-tertiary)';
}

function stepSubLabel(step: PhaseStep): string {
  const { status, timestamp, key } = step;
  if (key === 'scored' && status === 'past') return 'complete';
  if (timestamp !== null) {
    const f = formatPhaseTimestamp(timestamp);
    return `${f.date} · ${f.time}`;
  }
  if (status === 'active') return 'Awaiting';
  return 'Pending';
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function RoundTimeline({ round }: {
  round: Round;
  agentNames: Map<string, string>; // kept for API compatibility
}) {
  const now = Math.floor(Date.now() / 1000);
  const steps = useMemo(() => buildPhaseSteps(round, now), [round, now]);

  if (round.invalidated) return <VoidedTimeline round={round} />;

  const hasAnomaly = steps.some(s => s.anomaly !== null);
  const N = steps.length;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start' }}>
        {steps.map((step, i) => {
          const isFirst = i === 0;
          const isLast  = i === N - 1;
          const isActive = step.status === 'active';
          const isPending = step.status === 'pending';
          const isActivePending = isActive && step.timestamp === null;
          const isAnomaly = step.anomaly !== null;

          const dot  = dotStyle(step);
          const lCol = labelColor(step);
          const sub  = stepSubLabel(step);

          return (
            <div
              key={step.key}
              style={{
                flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
                position: 'relative',
                opacity: isPending && !isActive ? 0.45 : 1,
              }}
            >
              {/* Left connector */}
              {!isFirst && (
                <div style={{ ...connectorStyle(steps[i - 1], step), left: 0, right: '50%' }} />
              )}

              {/* Right connector */}
              {!isLast && (
                <div style={{ ...connectorStyle(step, steps[i + 1]), left: '50%', right: 0 }} />
              )}

              {/* Glow ring — active non-pending only */}
              {isActive && !isActivePending && (
                <div style={{
                  position: 'absolute', top: -4,
                  width: 28, height: 28, borderRadius: '50%',
                  border: '1.5px solid var(--fa-gold)', opacity: 0.2,
                  zIndex: 0,
                }} />
              )}

              {/* Dot */}
              <div style={{
                width: 20, height: 20, borderRadius: '50%',
                zIndex: 1, position: 'relative', boxSizing: 'border-box',
                ...dot,
              }} />

              {/* Label + anomaly icon */}
              <div style={{
                marginTop: 8,
                fontFamily: 'var(--fa-font-mono)', fontSize: 10,
                textTransform: 'uppercase', letterSpacing: '0.09em',
                color: lCol,
                fontWeight: (isActive || isAnomaly) ? 600 : 400,
                display: 'flex', alignItems: 'center', gap: 3,
                whiteSpace: 'nowrap',
              }}>
                {step.label}
                {isAnomaly && (
                  <span
                    title={step.anomaly!.message}
                    aria-label={step.anomaly!.message}
                    style={{ cursor: 'help', fontSize: 12, lineHeight: 1, opacity: 0.85 }}
                  >
                    ⓘ
                  </span>
                )}
              </div>

              {/* Timestamp / status */}
              <div style={{
                marginTop: 2,
                fontFamily: 'var(--fa-font-mono)', fontSize: 9,
                color: 'var(--fa-text-tertiary)', opacity: 0.65,
                whiteSpace: 'nowrap',
              }}>
                {sub}
              </div>
            </div>
          );
        })}
      </div>

      {/* Anomaly banner */}
      {hasAnomaly && (
        <div style={{
          marginTop: 16, padding: '8px 12px',
          fontFamily: 'var(--fa-font-mono)', fontSize: 11,
          color: 'var(--fa-text-tertiary)',
          borderLeft: '2px solid var(--fa-danger)',
          background: 'var(--fa-danger-bg)', borderRadius: 4,
        }}>
          Atypical sequence — see step indicators. Reasons may include disputed markets, early resolution, or other on-chain events.
        </div>
      )}
    </div>
  );
}
