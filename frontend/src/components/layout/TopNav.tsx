import { useState, useEffect } from 'react';
import type { CSSProperties } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import Brand from '../Brand';

const mobileCSS = `
  @media (max-width: 800px) {
    .topnav-center    { display: none !important; }
    .topnav-pill      { display: none !important; }
    .topnav-ext       { display: none !important; }
    .topnav-github    { display: none !important; }
    .topnav-hamburger { display: flex !important; }
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

const mobileLinkStyle = ({ isActive }: { isActive: boolean }): CSSProperties => ({
  fontSize: 17,
  fontWeight: 500,
  color: isActive ? 'var(--fa-text-primary)' : 'var(--fa-text-secondary)',
  textDecoration: 'none',
  padding: '14px 0',
  borderBottom: '1px solid var(--fa-border-soft)',
  display: 'block',
});

export default function TopNav() {
  const [open, setOpen] = useState(false);
  const location = useLocation();

  useEffect(() => { setOpen(false); }, [location.pathname]);

  return (
    <>
      <style>{mobileCSS}</style>
      <header className="topnav-header" style={headerStyle}>
        <Link to="/" style={{ textDecoration: 'none' }}>
          <Brand size="sm" />
        </Link>

        <nav className="topnav-center" style={navStyle}>
          <NavLink to="/events" style={navLinkStyle}>Events</NavLink>
          <NavLink to="/rounds" style={navLinkStyle}>Rounds</NavLink>
          <NavLink to="/leaderboard" style={navLinkStyle}>Leaderboard</NavLink>
          <NavLink to="/developer" style={navLinkStyle}>Developer</NavLink>
          <a
            href="https://www.foresightflow.org/"
            target="_blank"
            rel="noopener noreferrer"
            style={baseLinkStyle}
            className="topnav-ext"
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
            className="topnav-github"
          >
            GitHub ↗
          </a>

          {/* Hamburger — hidden on desktop via CSS */}
          <button
            className="topnav-hamburger"
            onClick={() => setOpen(o => !o)}
            aria-label={open ? 'Close menu' : 'Open menu'}
            style={{
              display: 'none',
              alignItems: 'center',
              justifyContent: 'center',
              width: 36, height: 36,
              background: 'none',
              border: '1px solid var(--fa-border-soft)',
              borderRadius: 8,
              cursor: 'pointer',
              fontSize: 18,
              color: 'var(--fa-text-secondary)',
              flexShrink: 0,
            }}
          >
            {open ? '✕' : '☰'}
          </button>
        </div>
      </header>

      {/* Mobile dropdown menu */}
      {open && (
        <nav style={{
          background: 'var(--fa-bg-base)',
          borderBottom: '1px solid var(--fa-border-soft)',
          padding: '0 clamp(20px, 4vw, 40px) 12px',
        }}>
          <NavLink to="/events" style={mobileLinkStyle}>Events</NavLink>
          <NavLink to="/rounds" style={mobileLinkStyle}>Rounds</NavLink>
          <NavLink to="/leaderboard" style={mobileLinkStyle}>Leaderboard</NavLink>
          <NavLink to="/developer" style={mobileLinkStyle}>Developer</NavLink>
          <a
            href="https://www.foresightflow.org/"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              ...mobileLinkStyle({ isActive: false }),
              borderBottom: 'none',
              paddingBottom: 8,
            }}
          >
            Research ↗
          </a>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            paddingTop: 12, marginTop: 4,
            borderTop: '1px solid var(--fa-border-soft)',
          }}>
            <span style={{ ...pillStyle, display: 'inline-flex' }}>
              <span style={dotStyle} />
              Polygon mainnet
            </span>
            <a
              href="https://github.com/foresight-arena"
              target="_blank"
              rel="noopener noreferrer"
              style={{ ...githubLinkStyle, padding: 0 }}
            >
              GitHub ↗
            </a>
          </div>
        </nav>
      )}
    </>
  );
}
