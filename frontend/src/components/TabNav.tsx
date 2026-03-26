import type { CSSProperties } from 'react';
import { NavLink } from 'react-router-dom';

const navStyle: CSSProperties = {
  display: 'flex',
  gap: 'var(--space-sm)',
  marginBottom: 'var(--space-lg)',
};

const baseLinkStyle: CSSProperties = {
  padding: '8px 18px',
  fontSize: '0.875rem',
  fontWeight: 600,
  borderRadius: 'var(--radius-sm)',
  textDecoration: 'none',
  transition: 'all 0.15s ease',
};

function linkStyle(isActive: boolean): CSSProperties {
  return {
    ...baseLinkStyle,
    backgroundColor: isActive ? 'var(--accent)' : 'var(--bg-tertiary)',
    color: isActive ? '#000' : 'var(--text-secondary)',
    border: `1px solid ${isActive ? 'var(--accent)' : 'var(--border)'}`,
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
    </nav>
  );
}
