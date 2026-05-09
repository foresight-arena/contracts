import { useMemo } from 'react';
import type { Round } from '../types';
import { buildPhaseSteps, getActivePhaseIndex, type PhaseKey, type PhaseStep } from '../lib/roundPhase';

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmtDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fmtCountdown(ts: number, now: number): string {
  const diff = ts - now;
  if (diff <= 0) return fmtDate(ts);
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  if (h > 48) return `in ${Math.floor(h / 24)}d`;
  if (h > 0) return `in ${h}h ${m}m`;
  return `in ${m}m`;
}

function getStepSub(
  step: PhaseStep,
  round: Round,
  now: number,
  isPast: boolean,
  isActive: boolean,
): string {
  const hasScores = Array.from(round.agents.values()).some(a => a.scoredMarkets > 0);
  const key: PhaseKey = step.key;

  if (key === 'commit') {
    if (isActive) return fmtCountdown(round.commitDeadline, now);
    if (isPast) return fmtDate(round.commitDeadline);
    return '—';
  }
  if (key === 'buffer') {
    if (isActive) return fmtCountdown(round.revealStart, now);
    if (isPast) return fmtDate(round.revealStart);
    return '—';
  }
  if (key === 'reveal') {
    if (isActive) return fmtCountdown(round.revealDeadline, now);
    if (isPast) return fmtDate(round.revealDeadline);
    return 'pending';
  }
  if (key === 'triggered') {
    if (round.outcomesTriggered && round.outcomesTriggeredAt > 0) return fmtDate(round.outcomesTriggeredAt);
    if (isActive) return 'pending';
    return '—';
  }
  // scored
  if (hasScores) return 'complete';
  if (isActive) return 'pending';
  return '—';
}

// ─── layout ──────────────────────────────────────────────────────────────────

const W = 640;
const H = 80;
const PAD = 40;
const CY = 26;

// ─── voided phases for invalidated rounds ─────────────────────────────────────

type PhaseState = 'done' | 'active' | 'future' | 'void' | 'voided';

interface VoidedPhase {
  label: string;
  sub: string;
  state: PhaseState;
}

function buildVoidedPhases(round: Round): VoidedPhase[] {
  return [
    { label: 'Commit',    sub: fmtDate(round.commitDeadline), state: 'void' },
    { label: 'Reveal',    sub: fmtDate(round.revealDeadline), state: 'void' },
    { label: 'Triggered', sub: '—',                           state: 'void' },
    { label: 'Scored',    sub: '—',                           state: 'void' },
    { label: 'Voided',    sub: '—',                           state: 'voided' },
  ];
}

// ─── component ───────────────────────────────────────────────────────────────

export default function RoundTimeline({ round }: {
  round: Round;
  agentNames: Map<string, string>; // kept for API compatibility
}) {
  const now = Math.floor(Date.now() / 1000);

  const steps = useMemo(() => buildPhaseSteps(round), [round]);
  const activeIndex = useMemo(() => getActivePhaseIndex(steps, now), [steps, now]);

  // ── Invalidated: keep voided visual ──────────────────────────────────────
  if (round.invalidated) {
    const voided = buildVoidedPhases(round);
    const N = voided.length;
    const plotW = W - 2 * PAD;
    const cx = (i: number) => PAD + (i / (N - 1)) * plotW;

    return (
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: 'auto', display: 'block', overflow: 'visible' }}
      >
        {voided.slice(0, -1).map((_ph, i) => (
          <line
            key={i}
            x1={cx(i) + 9} y1={CY}
            x2={cx(i + 1) - 9} y2={CY}
            style={{ stroke: 'var(--fa-text-tertiary)', strokeWidth: 1.5, opacity: 0.3 }}
          />
        ))}
        {voided.map((ph, i) => {
          const x = cx(i);
          const voided_ = ph.state === 'voided';
          const voidDim = ph.state === 'void';
          return (
            <g key={i} style={{ opacity: voidDim ? 0.35 : 1 }}>
              <circle cx={x} cy={CY} r={voided_ ? 10 : 8}
                style={{
                  fill: voided_ ? 'var(--fa-danger)' : 'none',
                  stroke: voided_ ? 'none' : 'var(--fa-border-soft)',
                  strokeWidth: 1.5,
                }}
              />
              <text x={x} y={CY + 19} textAnchor="middle"
                style={{
                  fontFamily: 'var(--fa-font-mono)', fontSize: 10,
                  textTransform: 'uppercase', letterSpacing: '0.09em',
                  fill: voided_ ? 'var(--fa-danger)' : 'var(--fa-text-tertiary)',
                  fontWeight: voided_ ? '600' : '400',
                }}
              >
                {ph.label}
              </text>
              <text x={x} y={CY + 31} textAnchor="middle"
                style={{ fontFamily: 'var(--fa-font-mono)', fontSize: 9, fill: 'var(--fa-text-tertiary)', opacity: 0.65 }}
              >
                {ph.sub}
              </text>
            </g>
          );
        })}
      </svg>
    );
  }

  // ── Normal: timestamp-driven phases ──────────────────────────────────────
  const N = steps.length;
  const plotW = W - 2 * PAD;
  const cx = (i: number) => PAD + (i / (N - 1)) * plotW;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ width: '100%', height: 'auto', display: 'block', overflow: 'visible' }}
    >
      {/* Connectors */}
      {steps.slice(0, -1).map((_step, i) => {
        const iActive = i === activeIndex;
        const nActive = i + 1 === activeIndex;
        const iPast = i < activeIndex;
        const nPast = i + 1 < activeIndex;
        const r1 = iActive ? 11 : 9;
        const r2 = nActive ? 11 : 9;
        const bothDone = iPast && nPast;
        const toActive = iPast && nActive;
        return (
          <line
            key={i}
            x1={cx(i) + r1} y1={CY}
            x2={cx(i + 1) - r2} y2={CY}
            style={{
              stroke: bothDone || toActive
                ? (toActive ? 'var(--fa-gold)' : 'var(--fa-text-tertiary)')
                : 'var(--fa-border-soft)',
              strokeWidth: 1.5,
              strokeDasharray: (!bothDone && !toActive) ? '4 3' : 'none',
            }}
          />
        );
      })}

      {/* Nodes */}
      {steps.map((step, i) => {
        const isActive = i === activeIndex;
        const isPast   = i < activeIndex;
        const x = cx(i);
        const r = isActive ? 10 : 8;
        const sub = getStepSub(step, round, now, isPast, isActive);

        return (
          <g key={step.key}>
            {/* Glow ring */}
            {isActive && (
              <circle cx={x} cy={CY} r={16}
                style={{ fill: 'none', stroke: 'var(--fa-gold)', strokeWidth: 1.5, opacity: 0.2 }}
              />
            )}

            {/* Circle */}
            <circle cx={x} cy={CY} r={r}
              style={{
                fill: isPast ? 'var(--fa-text-tertiary)' : isActive ? 'var(--fa-gold)' : 'none',
                stroke: (!isPast && !isActive) ? 'var(--fa-border-soft)' : 'none',
                strokeWidth: 1.5,
              }}
            />

            {/* Phase label */}
            <text x={x} y={CY + 19} textAnchor="middle"
              style={{
                fontFamily: 'var(--fa-font-mono)',
                fontSize: 10,
                textTransform: 'uppercase',
                letterSpacing: '0.09em',
                fill: isActive ? 'var(--fa-gold)' : 'var(--fa-text-tertiary)',
                fontWeight: isActive ? '600' : '400',
              }}
            >
              {step.label}
            </text>

            {/* Sub-label */}
            <text x={x} y={CY + 31} textAnchor="middle"
              style={{
                fontFamily: 'var(--fa-font-mono)',
                fontSize: 9,
                fill: 'var(--fa-text-tertiary)',
                opacity: 0.65,
              }}
            >
              {sub}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
