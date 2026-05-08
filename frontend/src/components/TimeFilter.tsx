import type { CSSProperties } from 'react';
import type { TimePeriod } from '../types';

interface Props {
  value: TimePeriod;
  onChange: (v: TimePeriod) => void;
}

const containerStyle: CSSProperties = {
  display: 'inline-flex',
  gap: 4,
  padding: 3,
  border: '1px solid var(--fa-border-soft)',
  borderRadius: 8,
  background: 'var(--fa-bg-base)',
};

function btnStyle(active: boolean): CSSProperties {
  return {
    padding: '6px 14px',
    fontFamily: 'var(--fa-font-mono)',
    fontSize: 11,
    letterSpacing: '0.05em',
    background: active ? 'var(--fa-bg-card)' : 'transparent',
    color: active ? 'var(--fa-gold)' : 'var(--fa-text-secondary)',
    border: 'none',
    borderRadius: 5,
    cursor: 'pointer',
    transition: 'background 120ms ease, color 120ms ease',
  };
}

const options: { label: string; value: TimePeriod }[] = [
  { label: 'All', value: 'all' },
  { label: '7d', value: '7d' },
  { label: '30d', value: '30d' },
];

export default function TimeFilter({ value, onChange }: Props) {
  return (
    <div style={containerStyle}>
      {options.map((opt) => (
        <button
          key={opt.value}
          style={btnStyle(value === opt.value)}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
