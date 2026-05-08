import { useMemo } from 'react';
import type { Round } from '../types';

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

// ─── layout ──────────────────────────────────────────────────────────────────

const W = 640;
const H = 80;
const PAD = 40;
const CY = 26;

// ─── types ───────────────────────────────────────────────────────────────────

type PhaseState = 'done' | 'active' | 'future' | 'void' | 'voided';

interface Phase {
  label: string;
  sub: string;
  state: PhaseState;
}

// ─── component ───────────────────────────────────────────────────────────────

export default function RoundTimeline({ round }: {
  round: Round;
  agentNames: Map<string, string>; // kept for API compatibility
}) {
  const now = Math.floor(Date.now() / 1000);

  const phases = useMemo<Phase[]>(() => {
    const hasScores = Array.from(round.agents.values()).some(a => a.scoredMarkets > 0);
    const commitDone = now >= round.commitDeadline;
    const revealDone = now >= round.revealDeadline;

    if (round.invalidated) {
      return [
        { label: 'Commit',    sub: fmtDate(round.commitDeadline), state: 'void' },
        { label: 'Reveal',    sub: fmtDate(round.revealDeadline), state: 'void' },
        { label: 'Triggered', sub: '—',                           state: 'void' },
        { label: 'Scored',    sub: '—',                           state: 'void' },
        { label: 'Voided',    sub: '—',                           state: 'voided' },
      ];
    }

    return [
      {
        label: 'Commit',
        sub: commitDone
          ? fmtDate(round.commitDeadline)
          : fmtCountdown(round.commitDeadline, now),
        state: commitDone ? 'done' : 'active',
      },
      {
        label: 'Reveal',
        sub: revealDone
          ? fmtDate(round.revealDeadline)
          : commitDone
          ? fmtCountdown(round.revealDeadline, now)
          : 'pending',
        state: revealDone ? 'done' : commitDone ? 'active' : 'future',
      },
      {
        label: 'Triggered',
        sub: round.outcomesTriggered && round.outcomesTriggeredAt
          ? fmtDate(round.outcomesTriggeredAt)
          : revealDone ? 'pending' : '—',
        state: round.outcomesTriggered ? 'done' : revealDone ? 'active' : 'future',
      },
      {
        label: 'Scored',
        sub: hasScores ? 'complete' : '—',
        state: hasScores ? 'done' : round.outcomesTriggered ? 'active' : 'future',
      },
    ];
  }, [round, now]);

  const N = phases.length;
  const plotW = W - 2 * PAD;
  const cx = (i: number) => PAD + (i / (N - 1)) * plotW;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ width: '100%', height: 'auto', display: 'block', overflow: 'visible' }}
    >
      {/* Connectors */}
      {phases.slice(0, -1).map((ph, i) => {
        const next = phases[i + 1];
        const r1 = ph.state === 'active' ? 11 : 9;
        const r2 = next.state === 'active' ? 11 : 9;
        const bothDone = ph.state === 'done' && next.state === 'done';
        const toActive = ph.state === 'done' && next.state === 'active';
        const isVoid = ph.state === 'void';
        return (
          <line
            key={i}
            x1={cx(i) + r1} y1={CY}
            x2={cx(i + 1) - r2} y2={CY}
            style={{
              stroke: isVoid || bothDone
                ? 'var(--fa-text-tertiary)'
                : toActive
                ? 'var(--fa-gold)'
                : 'var(--fa-border-soft)',
              strokeWidth: 1.5,
              strokeDasharray: (!bothDone && !toActive && !isVoid) ? '4 3' : 'none',
              opacity: isVoid ? 0.3 : 1,
            }}
          />
        );
      })}

      {/* Nodes */}
      {phases.map((ph, i) => {
        const x = cx(i);
        const active  = ph.state === 'active';
        const done    = ph.state === 'done';
        const voided  = ph.state === 'voided';
        const voidDim = ph.state === 'void';
        const r = active ? 10 : 8;

        return (
          <g key={i} style={{ opacity: voidDim ? 0.35 : 1 }}>
            {/* Glow ring */}
            {active && (
              <circle cx={x} cy={CY} r={16}
                style={{ fill: 'none', stroke: 'var(--fa-gold)', strokeWidth: 1.5, opacity: 0.2 }} />
            )}

            {/* Circle */}
            <circle cx={x} cy={CY} r={r}
              style={{
                fill: done ? 'var(--fa-text-tertiary)'
                  : active ? 'var(--fa-gold)'
                  : voided ? 'var(--fa-danger)'
                  : 'none',
                stroke: (!done && !active && !voided) ? 'var(--fa-border-soft)' : 'none',
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
                fill: active ? 'var(--fa-gold)'
                  : voided ? 'var(--fa-danger)'
                  : 'var(--fa-text-tertiary)',
                fontWeight: (active || voided) ? '600' : '400',
              }}
            >
              {ph.label}
            </text>

            {/* Sub-label (date or status) */}
            <text x={x} y={CY + 31} textAnchor="middle"
              style={{
                fontFamily: 'var(--fa-font-mono)',
                fontSize: 9,
                fill: 'var(--fa-text-tertiary)',
                opacity: 0.65,
              }}
            >
              {ph.sub}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
