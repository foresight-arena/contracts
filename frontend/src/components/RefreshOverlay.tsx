import type { CSSProperties } from 'react';

const overlayStyle: CSSProperties = {
  position: 'fixed',
  top: 12,
  right: 12,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 14px',
  backgroundColor: 'var(--bg-secondary)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  fontSize: '0.75rem',
  color: 'var(--text-secondary)',
  zIndex: 100,
  boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
};

const spinnerStyle: CSSProperties = {
  width: 14,
  height: 14,
  border: '2px solid var(--border)',
  borderTopColor: 'var(--accent)',
  borderRadius: '50%',
  animation: 'fsa-spin 0.8s linear infinite',
};

export default function RefreshOverlay() {
  return (
    <div style={overlayStyle}>
      <div style={spinnerStyle} />
      Refreshing...
    </div>
  );
}
