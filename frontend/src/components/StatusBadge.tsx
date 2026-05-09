import type { CSSProperties } from 'react';
import type { Round } from '../types';
import { getActivePhase, type PhaseKey } from '../lib/roundPhase';

interface Props {
  round: Round;
  now?: number;
}

interface StatusDef {
  label: string;
  bg: string;
  color: string;
}

function statusFromPhase(phase: PhaseKey | 'void', benchmarksPosted: boolean): StatusDef {
  switch (phase) {
    case 'commit':
      return { label: 'Commit', bg: 'var(--fa-gold-bg)', color: 'var(--accent)' };
    case 'buffer':
      return { label: 'Buffer', bg: 'var(--fa-danger-bg)', color: 'var(--fa-danger)' };
    case 'reveal':
      if (!benchmarksPosted) {
        return { label: 'Awaiting Benchmarks', bg: 'var(--fa-gold-bg)', color: 'var(--warning)' };
      }
      return { label: 'Reveal', bg: 'var(--fa-success-bg)', color: 'var(--success)' };
    case 'triggered':
      return { label: 'Triggered', bg: 'var(--fa-polygon-bg)', color: 'var(--fa-polygon)' };
    case 'scored':
      return { label: 'Finalized', bg: 'var(--bg-tertiary)', color: 'var(--text-secondary)' };
    case 'void':
      return { label: 'Invalidated', bg: 'var(--fa-danger-bg)', color: 'var(--error)' };
  }
}

export default function StatusBadge({ round, now = Math.floor(Date.now() / 1000) }: Props) {
  const phase = getActivePhase(round, now);
  const status = statusFromPhase(phase, round.benchmarksPosted);

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
