import type { CSSProperties } from 'react';

interface Props {
  round: {
    commitDeadline: number;
    revealStart: number;
    revealDeadline: number;
    invalidated: boolean;
    benchmarksPosted: boolean;
  };
  now?: number;
}

interface StatusDef {
  label: string;
  bg: string;
  color: string;
}

function getStatus(round: Props['round'], now: number): StatusDef {
  if (round.invalidated) {
    return { label: 'Invalidated', bg: 'var(--fa-danger-bg)', color: 'var(--error)' };
  }
  if (now < round.commitDeadline) {
    return { label: 'Commit', bg: 'var(--fa-gold-bg)', color: 'var(--accent)' };
  }
  if (now < round.revealStart) {
    return { label: 'Buffer', bg: 'var(--fa-gold-bg)', color: 'var(--warning)' };
  }
  if (now < round.revealDeadline) {
    if (!round.benchmarksPosted) {
      return { label: 'Awaiting Benchmarks', bg: 'var(--fa-gold-bg)', color: 'var(--warning)' };
    }
    return { label: 'Reveal', bg: 'var(--fa-success-bg)', color: 'var(--success)' };
  }
  return { label: 'Finalized', bg: 'var(--bg-tertiary)', color: 'var(--text-secondary)' };
}

export default function StatusBadge({ round, now = Math.floor(Date.now() / 1000) }: Props) {
  const status = getStatus(round, now);

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
