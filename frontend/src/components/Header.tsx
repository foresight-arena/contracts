import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  padding: 'var(--space-md) 0',
  marginBottom: 'var(--space-sm)',
};

const brandStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-sm)',
  textDecoration: 'none',
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

export default function Header() {
  return (
    <header style={headerStyle}>
      <Link to="/" style={brandStyle}>
        <div style={logoStyle}>F</div>
        <span style={titleStyle}>Foresight Arena</span>
      </Link>
    </header>
  );
}
