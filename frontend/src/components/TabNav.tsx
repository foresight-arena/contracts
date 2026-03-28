import type { CSSProperties } from 'react';
import { NavLink } from 'react-router-dom';

const navStyle: CSSProperties = {
  display: 'flex',
  gap: 'var(--space-xs)',
  paddingBottom: 'var(--space-md)',
  borderBottom: '1px solid var(--border)',
  marginBottom: 'var(--space-lg)',
};

function linkStyle(isActive: boolean): CSSProperties {
  return {
    padding: '8px 16px',
    fontSize: '0.8125rem',
    fontWeight: 500,
    borderRadius: 'var(--radius-sm)',
    textDecoration: 'none',
    transition: 'all 0.2s ease',
    color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
    backgroundColor: isActive ? 'var(--accent-soft)' : 'transparent',
    border: 'none',
  };
}

export default function TabNav() {
  return (
    <nav style={navStyle}>
      <NavLink to="/" end style={({ isActive }) => linkStyle(isActive)}>
        Arena
      </NavLink>
      <NavLink to="/leaderboard" style={({ isActive }) => linkStyle(isActive)}>
        Leaderboard
      </NavLink>
      <NavLink to="/about" style={({ isActive }) => linkStyle(isActive)}>
        About
      </NavLink>
    </nav>
  );
}
