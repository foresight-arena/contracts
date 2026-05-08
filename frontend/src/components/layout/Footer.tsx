import React from 'react';
import { Link } from 'react-router-dom';
import Brand from '../Brand';

const footerLinkStyle: React.CSSProperties = {
  fontFamily: 'var(--fa-font-mono)',
  fontSize: 12,
  color: 'var(--fa-text-secondary)',
  textDecoration: 'none',
  transition: 'color 120ms ease',
  whiteSpace: 'nowrap',
};

const footerCSS = `
  .footer-link:hover { color: var(--fa-text-primary) !important; }
`;

export default function Footer(): JSX.Element {
  return (
    <>
      <style>{footerCSS}</style>
      <footer style={{
        marginTop: 96,
        borderTop: '1px solid var(--fa-border-soft)',
        padding: '40px clamp(20px, 4vw, 40px) 32px',
      }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>

          {/* Row 1: brand LEFT · links MIDDLE · social RIGHT */}
          <div style={{
            display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
            gap: 32, flexWrap: 'wrap',
          }}>
            {/* Brand + tagline */}
            <div style={{ flex: '1 1 280px', minWidth: 220 }}>
              <Brand size="sm" />
              <p style={{
                fontSize: 13, color: 'var(--fa-text-tertiary)',
                lineHeight: 1.55, margin: '12px 0 0', maxWidth: '32ch',
              }}>
                On-chain prediction benchmark for AI agents. Permissionless registration, sealed
                commit-reveal, ERC-8004 reputation.
              </p>
            </div>

            {/* Inline links */}
            <nav style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
              <Link to="/about" className="footer-link" style={footerLinkStyle}>About</Link>
              <Link to="/developer" className="footer-link" style={footerLinkStyle}>Developer</Link>
              <a
                href="https://www.foresightflow.org"
                target="_blank"
                rel="noopener noreferrer"
                className="footer-link"
                style={footerLinkStyle}
              >
                Research ↗
              </a>
            </nav>

            {/* Social */}
            <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
              <a
                href="https://x.com/ForesightFlow"
                target="_blank"
                rel="noopener noreferrer"
                className="footer-link"
                style={footerLinkStyle}
                aria-label="Twitter / X"
              >
                Twitter ↗
              </a>
              <a
                href="https://github.com/foresight-arena"
                target="_blank"
                rel="noopener noreferrer"
                className="footer-link"
                style={footerLinkStyle}
                aria-label="GitHub"
              >
                GitHub ↗
              </a>
            </div>
          </div>

          {/* Row 2: thin meta strip */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 16, flexWrap: 'wrap',
            paddingTop: 20,
            borderTop: '1px solid var(--fa-border-soft)',
            fontFamily: 'var(--fa-font-mono)', fontSize: 11,
            color: 'var(--fa-text-tertiary)',
            textTransform: 'uppercase', letterSpacing: '0.1em',
          }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--fa-success)', flexShrink: 0 }} />
              Polygon mainnet
            </span>
            <span>Maintained by ForesightFlow research · {new Date().getFullYear()}</span>
          </div>

        </div>
      </footer>
    </>
  );
}
