import type { CSSProperties } from 'react';
import { useContractContext } from '../context/ContractContext';
import type { ContractSetName } from '../config/contracts';

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  paddingBottom: 'var(--space-md)',
  borderBottom: '1px solid var(--border)',
  marginBottom: 'var(--space-md)',
};

const titleStyle: CSSProperties = {
  fontSize: '1.5rem',
  fontWeight: 700,
  color: 'var(--text-primary)',
  letterSpacing: '-0.02em',
};

const toggleGroupStyle: CSSProperties = {
  display: 'flex',
  gap: 'var(--space-xs)',
};

function toggleBtnStyle(active: boolean): CSSProperties {
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

export default function Header() {
  const { contractSet, setContractSet } = useContractContext();

  const options: { label: string; value: ContractSetName }[] = [
    { label: 'Fast', value: 'fast' },
    { label: 'Production', value: 'production' },
  ];

  return (
    <header style={headerStyle}>
      <span style={titleStyle}>Foresight Arena</span>
      <div style={toggleGroupStyle}>
        {options.map((opt) => (
          <button
            key={opt.value}
            style={toggleBtnStyle(contractSet === opt.value)}
            onClick={() => setContractSet(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </header>
  );
}
