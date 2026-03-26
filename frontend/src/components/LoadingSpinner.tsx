import type { CSSProperties } from 'react';

const containerStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 'var(--space-2xl)',
  gap: 'var(--space-md)',
};

const spinnerStyle: CSSProperties = {
  width: 32,
  height: 32,
  border: '3px solid var(--border)',
  borderTopColor: 'var(--accent)',
  borderRadius: '50%',
  animation: 'fsa-spin 0.8s linear infinite',
};

const textStyle: CSSProperties = {
  color: 'var(--text-secondary)',
  fontSize: '0.875rem',
};

const keyframes = `
@keyframes fsa-spin {
  to { transform: rotate(360deg); }
}
`;

export default function LoadingSpinner() {
  return (
    <>
      <style>{keyframes}</style>
      <div style={containerStyle}>
        <div style={spinnerStyle} />
        <span style={textStyle}>Loading...</span>
      </div>
    </>
  );
}
