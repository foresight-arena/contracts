import type { CSSProperties } from 'react';
import { useDataContext } from '../context/DataContext';

const bannerStyle: CSSProperties = {
  padding: 'var(--space-sm) var(--space-md)',
  backgroundColor: 'var(--error-soft)',
  border: '1px solid var(--error)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--error)',
  fontSize: '0.8125rem',
  marginBottom: 'var(--space-md)',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
};

export default function ErrorBanner() {
  const { error, refresh } = useDataContext();
  if (!error) return null;

  return (
    <div style={bannerStyle}>
      <span>Subgraph error: {error}</span>
      <button
        onClick={refresh}
        style={{
          background: 'none',
          border: '1px solid var(--error)',
          borderRadius: 'var(--radius-sm)',
          color: 'var(--error)',
          padding: '2px 10px',
          cursor: 'pointer',
          fontSize: '0.75rem',
        }}
      >
        Retry
      </button>
    </div>
  );
}
