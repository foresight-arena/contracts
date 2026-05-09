import { useMemo, type CSSProperties } from 'react';
import type { Round } from '../types';
import {
  buildPhaseSteps,
  getActivePhaseIndex,
  formatPhaseTimestamp,
} from '../lib/roundPhase';

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
              <div style={{
                position: 'absolute', top: 9, left: 0, right: '50%', height: 1.5,
                borderTop: '1.5px solid var(--fa-border-soft)', opacity: 0.3,
              }} />
            )}
            {!isLast && (
              <div style={{
                position: 'absolute', top: 9, left: '50%', right: 0, height: 1.5,
                borderTop: '1.5px solid var(--fa-border-soft)', opacity: 0.3,
              }} />
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
              fontWeight: ph.terminal ? 600 : 400,
              opacity: ph.terminal ? 1 : 0.35,
            }}>
              {ph.label}
            </div>
            <div style={{
              marginTop: 2, fontFamily: 'var(--fa-font-mono)', fontSize: 9,
              color: 'var(--fa-text-tertiary)', opacity: 0.4,
            }}>
              {ph.sub}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Connector helper ─────────────────────────────────────────────────────────

function connectorStyle(isPrevPast: boolean, isPrevActive: boolean, isThisPast: boolean, isThisActive: boolean): CSSProperties {
  const bothDone    = isPrevPast  && isThisPast;
  const toActive    = isPrevPast  && isThisActive;
  const fromActive  = isPrevActive && isThisPast;
  const solid = bothDone || toActive || fromActive;
  const color = toActive
    ? 'var(--fa-gold)'
    : (bothDone || fromActive)
    ? 'var(--fa-text-tertiary)'
    : 'var(--fa-border-soft)';

  return {
    position: 'absolute', top: 9, height: 1.5,
    borderTop: solid ? `1.5px solid ${color}` : `1.5px dashed var(--fa-border-soft)`,
  };
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function RoundTimeline({ round }: {
  round: Round;
  agentNames: Map<string, string>; // kept for API compatibility
}) {
  const now = Math.floor(Date.now() / 1000);
  const steps = useMemo(() => buildPhaseSteps(round), [round]);
  const activeIndex = useMemo(() => getActivePhaseIndex(steps, now), [steps, now]);

  if (round.invalidated) return <VoidedTimeline round={round} />;

  const hasAnomaly = steps.some(s => s.anomaly !== null);
  const N = steps.length;

  return (
    <div>
      {/* ── Timeline nodes ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start' }}>
        {steps.map((step, i) => {
          const isActive  = i === activeIndex;
          const isPast    = i < activeIndex;
          const isFuture  = i > activeIndex;
          const isFirst   = i === 0;
          const isLast    = i === N - 1;
          const isAnomaly = step.anomaly !== null;

          const prevIsPast   = i - 1 < activeIndex && i > 0;
          const prevIsActive = i - 1 === activeIndex;
          const nextIsPast   = i + 1 < activeIndex;
          const nextIsActive = i + 1 === activeIndex;

          const formatted = step.timestamp !== null ? formatPhaseTimestamp(step.timestamp) : null;

          const subLabel = step.key === 'scored'
            ? 'complete'
            : formatted
            ? `${formatted.date} · ${formatted.time}`
            : '—';

          return (
            <div key={step.key} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}>

              {/* Left connector */}
              {!isFirst && (
                <div style={{
                  ...connectorStyle(prevIsPast, prevIsActive, isPast, isActive),
                  left: 0, right: '50%',
                }} />
              )}

              {/* Right connector */}
              {!isLast && (
                <div style={{
                  ...connectorStyle(isPast, isActive, nextIsPast, nextIsActive),
                  left: '50%', right: 0,
                  // future→future is always dashed; override if needed
                  ...(isFuture && !nextIsPast && !nextIsActive
                    ? { borderTop: '1.5px dashed var(--fa-border-soft)' }
                    : {}),
                }} />
              )}

              {/* Glow ring */}
              {isActive && (
                <div style={{
                  position: 'absolute', top: -4,
                  width: 28, height: 28, borderRadius: '50%',
                  border: '1.5px solid var(--fa-gold)', opacity: 0.2,
                  zIndex: 0,
                }} />
              )}

              {/* Dot */}
              <div style={{
                width: 20, height: 20, borderRadius: '50%', zIndex: 1, position: 'relative',
                boxSizing: 'border-box',
                background: isActive
                  ? 'var(--fa-gold)'
                  : isPast
                  ? 'var(--fa-text-tertiary)'
                  : 'transparent',
                border: isAnomaly
                  ? '2px dashed var(--fa-danger)'
                  : isActive
                  ? 'none'
                  : isPast
                  ? 'none'
                  : '1.5px solid var(--fa-border-soft)',
              }} />

              {/* Label + anomaly icon */}
              <div style={{
                marginTop: 8,
                fontFamily: 'var(--fa-font-mono)', fontSize: 10,
                textTransform: 'uppercase', letterSpacing: '0.09em',
                color: isAnomaly
                  ? 'var(--fa-danger)'
                  : isActive
                  ? 'var(--fa-gold)'
                  : 'var(--fa-text-tertiary)',
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

              {/* Timestamp */}
              <div style={{
                marginTop: 2,
                fontFamily: 'var(--fa-font-mono)', fontSize: 9,
                color: 'var(--fa-text-tertiary)', opacity: 0.65,
                whiteSpace: 'nowrap',
              }}>
                {subLabel}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Anomaly banner ── */}
      {hasAnomaly && (
        <div style={{
          marginTop: 16,
          padding: '8px 12px',
          fontFamily: 'var(--fa-font-mono)', fontSize: 11,
          color: 'var(--fa-text-tertiary)',
          borderLeft: '2px solid var(--fa-danger)',
          background: 'var(--fa-danger-bg)',
          borderRadius: 4,
        }}>
          Atypical sequence — see step indicators. Reasons may include disputed markets, early resolution, or other on-chain events.
        </div>
      )}
    </div>
  );
}
