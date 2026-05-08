import type { CSSProperties } from 'react';
import { Link, NavLink } from 'react-router-dom';
import Brand from '../Brand';

const mobileCSS = `
  @media (max-width: 800px) {
    .topnav-center { display: none !important; }
    .topnav-pill   { display: none !important; }
  }
`;

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '20px clamp(20px, 4vw, 40px)',
  borderBottom: '1px solid var(--fa-border-soft)',
};

const navStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 28,
};

const baseLinkStyle: CSSProperties = {
  fontSize: 14,
  fontWeight: 500,
  color: 'var(--fa-text-secondary)',
  textDecoration: 'none',
  transition: 'color 120ms ease',
};

const activeLinkStyle: CSSProperties = {
  ...baseLinkStyle,
  color: 'var(--fa-text-primary)',
};

const rightStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
};

const pillStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 7,
  fontFamily: 'var(--fa-font-mono)',
  fontSize: 11.5,
  color: 'var(--fa-text-secondary)',
  padding: '5px 10px',
  border: '1px solid var(--fa-border-soft)',
  borderRadius: 999,
};

const dotStyle: CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: '50%',
  background: 'var(--fa-success)',
  boxShadow: '0 0 0 3px rgba(116,196,118,0.2)',
  flexShrink: 0,
};

const githubLinkStyle: CSSProperties = {
  color: 'var(--fa-text-secondary)',
  fontSize: 12.5,
  padding: '7px 12px',
  textDecoration: 'none',
  transition: 'color 120ms ease',
};

const navLinkStyle = ({ isActive }: { isActive: boolean }): CSSProperties =>
  isActive ? activeLinkStyle : baseLinkStyle;

export default function TopNav(): JSX.Element {
  return (
    <>
      <style>{mobileCSS}</style>
      <header style={headerStyle}>
        <Link to="/" style={{ textDecoration: 'none' }}>
          <Brand size="sm" />
        </Link>

        <nav className="topnav-center" style={navStyle}>
          <NavLink to="/leaderboard" style={navLinkStyle}>Leaderboard</NavLink>
          <NavLink to="/arena" style={navLinkStyle}>Rounds</NavLink>
          <a
            href="https://github.com/foresight-arena/sdk"
            target="_blank"
            rel="noopener noreferrer"
            style={baseLinkStyle}
          >
            Build ↗
          </a>
          <a
            href="https://www.foresightflow.org/"
            target="_blank"
            rel="noopener noreferrer"
            style={baseLinkStyle}
          >
            Research ↗
          </a>
        </nav>

        <div style={rightStyle}>
          <span className="topnav-pill" style={pillStyle}>
            <span style={dotStyle} />
            Polygon mainnet
          </span>
          <a
            href="https://github.com/foresight-arena"
            target="_blank"
            rel="noopener noreferrer"
            style={githubLinkStyle}
          >
            GitHub ↗
          </a>
        </div>
      </header>
    </>
  );
}
