import type { CSSProperties } from 'react';
import type { TimePeriod } from '../types';

interface Props {
  value: TimePeriod;
  onChange: (v: TimePeriod) => void;
}

const groupStyle: CSSProperties = {
  display: 'flex',
  gap: 'var(--space-xs)',
  marginBottom: 'var(--space-lg)',
};

function btnStyle(active: boolean): CSSProperties {
  return {
    padding: '6px 14px',
    fontSize: '0.8125rem',
    fontWeight: 600,
    border: '1px solid',
    borderColor: active ? 'var(--accent)' : 'var(--border)',
    borderRadius: 'var(--radius-sm)',
    backgroundColor: active ? 'var(--accent)' : 'var(--bg-tertiary)',
    color: active ? '#000' : 'var(--text-secondary)',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  };
}

const options: { label: string; value: TimePeriod }[] = [
  { label: 'All', value: 'all' },
  { label: '7d', value: '7d' },
  { label: '30d', value: '30d' },
];

export default function TimeFilter({ value, onChange }: Props) {
  return (
    <div style={groupStyle}>
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
