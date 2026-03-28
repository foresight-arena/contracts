import type { CSSProperties } from 'react';
import { useContractContext } from '../context/ContractContext';
import type { ContractSetName } from '../config/contracts';

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: 'var(--space-md) 0',
  marginBottom: 'var(--space-sm)',
};

const brandStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-sm)',
};

const logoStyle: CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: 'var(--radius-sm)',
  background: 'var(--gradient-accent)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '0.875rem',
  fontWeight: 800,
  color: '#fff',
};

const titleStyle: CSSProperties = {
  fontSize: '1.125rem',
  fontWeight: 700,
  color: 'var(--text-primary)',
  letterSpacing: '-0.03em',
};

const toggleGroupStyle: CSSProperties = {
  display: 'flex',
  backgroundColor: 'var(--bg-secondary)',
  borderRadius: 'var(--radius-sm)',
  padding: 2,
  border: '1px solid var(--border)',
};

function toggleBtnStyle(active: boolean): CSSProperties {
  return {
    padding: '5px 14px',
    fontSize: '0.6875rem',
    fontWeight: 600,
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    backgroundColor: active ? 'var(--accent)' : 'transparent',
    color: active ? '#fff' : 'var(--text-muted)',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    letterSpacing: '0.02em',
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
      <div style={brandStyle}>
        <div style={logoStyle}>F</div>
        <span style={titleStyle}>Foresight Arena</span>
      </div>
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
