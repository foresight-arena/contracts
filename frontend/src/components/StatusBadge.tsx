import type { CSSProperties } from 'react';

interface Props {
  round: {
    commitDeadline: number;
    revealStart: number;
    revealDeadline: number;
    invalidated: boolean;
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
    return { label: 'Invalidated', bg: 'rgba(248, 113, 113, 0.15)', color: 'var(--error)' };
  }
  if (now < round.commitDeadline) {
    return { label: 'Commit', bg: 'rgba(74, 158, 255, 0.15)', color: 'var(--accent)' };
  }
  if (now < round.revealStart) {
    return { label: 'Buffer', bg: 'rgba(251, 191, 36, 0.15)', color: 'var(--warning)' };
  }
  if (now < round.revealDeadline) {
    return { label: 'Reveal', bg: 'rgba(52, 211, 153, 0.15)', color: 'var(--success)' };
  }
  return { label: 'Finalized', bg: 'var(--bg-tertiary)', color: 'var(--text-secondary)' };
}

export default function StatusBadge({ round, now = Math.floor(Date.now() / 1000) }: Props) {
  const status = getStatus(round, now);

  const style: CSSProperties = {
    display: 'inline-block',
    fontSize: '0.75rem',
    fontWeight: 600,
    padding: '2px 8px',
    borderRadius: 'var(--radius-sm)',
    backgroundColor: status.bg,
    color: status.color,
    whiteSpace: 'nowrap',
  };

  return <span style={style}>{status.label}</span>;
}
