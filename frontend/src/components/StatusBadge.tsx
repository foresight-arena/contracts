import type { CSSProperties } from 'react';
import type { Round } from '../types';
import { getActiveStep, type PhaseKey } from '../lib/roundPhase';

interface Props {
  round: Round;
  now?: number;
}

interface StatusDef {
  label: string;
  bg: string;
  color: string;
}

function getStatusDef(round: Round, now: number): StatusDef {
  if (round.invalidated) {
    return { label: 'Invalidated', bg: 'var(--fa-danger-bg)', color: 'var(--error)' };
  }

  const step = getActiveStep(round, now);
  if (!step) {
    return { label: '—', bg: 'var(--bg-tertiary)', color: 'var(--text-secondary)' };
  }

  const isPending = step.timestamp === null; // active but event not yet occurred

  const defs: Record<PhaseKey, StatusDef> = {
    commit:    { label: 'Commit',     bg: 'var(--fa-gold-bg)',    color: 'var(--accent)' },
    buffer:    { label: 'Buffer',     bg: 'var(--fa-danger-bg)',  color: 'var(--fa-danger)' },
    reveal:    round.benchmarksPosted
                 ? { label: 'Reveal',              bg: 'var(--fa-success-bg)', color: 'var(--success)' }
                 : { label: 'Awaiting Benchmarks', bg: 'var(--fa-gold-bg)',    color: 'var(--warning)' },
    triggered: isPending
                 ? { label: 'Awaiting trigger', bg: 'var(--fa-teal-bg)', color: 'var(--fa-teal)' }
                 : { label: 'Triggered',         bg: 'var(--fa-polygon-bg)', color: 'var(--fa-polygon)' },
    scored:    isPending
                 ? { label: 'Awaiting scoring', bg: 'var(--fa-teal-bg)', color: 'var(--fa-teal)' }
                 : { label: 'Finalized',         bg: 'var(--bg-tertiary)', color: 'var(--text-secondary)' },
  };

  return defs[step.key];
}

export default function StatusBadge({ round, now = Math.floor(Date.now() / 1000) }: Props) {
  const status = getStatusDef(round, now);

  const style: CSSProperties = {
    display: 'inline-block',
    fontSize: '0.6875rem',
    fontWeight: 600,
    padding: '3px 10px',
    borderRadius: '100px',
    backgroundColor: status.bg,
    color: status.color,
    whiteSpace: 'nowrap',
    letterSpacing: '0.02em',
  };

  return <span style={style}>{status.label}</span>;
}
