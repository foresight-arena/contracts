import type { CSSProperties } from 'react';
import { NavLink } from 'react-router-dom';
import Brand from '../Brand';

const responsiveCSS = `
  .footer-grid {
    display: grid;
    grid-template-columns: 1.5fr 1fr 1fr 1fr;
    gap: 40px;
    margin-bottom: 40px;
  }
  @media (max-width: 700px) {
    .footer-grid { grid-template-columns: 1fr 1fr; }
  }
`;

const footerStyle: CSSProperties = {
  borderTop: '1px solid var(--fa-border-soft)',
  padding: '48px clamp(20px, 4vw, 40px) 32px',
  marginTop: 'clamp(64px, 8vw, 112px)',
};

const containerStyle: CSSProperties = {
  maxWidth: 1240,
  margin: '0 auto',
};

const brandBlurbStyle: CSSProperties = {
  fontSize: 13.5,
  color: 'var(--fa-text-secondary)',
  lineHeight: 1.6,
  maxWidth: '32ch',
  margin: '14px 0 0',
};

const colHeadStyle: CSSProperties = {
  fontFamily: 'var(--fa-font-mono)',
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
  color: 'var(--fa-text-tertiary)',
  marginBottom: 14,
  display: 'block',
};

const linkListStyle: CSSProperties = {
  listStyle: 'none',
  padding: 0,
  margin: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

const linkStyle: CSSProperties = {
  color: 'var(--fa-text-secondary)',
  fontSize: 14,
  textDecoration: 'none',
  transition: 'color 120ms ease',
  display: 'inline-block',
};

const bottomRowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 12,
  paddingTop: 24,
  borderTop: '1px solid var(--fa-border-soft)',
};

const copyrightStyle: CSSProperties = {
  fontFamily: 'var(--fa-font-mono)',
  fontSize: 12.5,
  color: 'var(--fa-text-tertiary)',
};

const fflowLinkStyle: CSSProperties = {
  color: 'var(--fa-text-secondary)',
  textDecoration: 'none',
  transition: 'color 120ms ease',
};

const socialsStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

const iconBtnStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 32,
  height: 32,
  border: '1px solid var(--fa-border-soft)',
  borderRadius: 8,
  color: 'var(--fa-text-secondary)',
  textDecoration: 'none',
  transition: 'color 120ms ease, border-color 120ms ease',
};

function IconGitHub() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2C6.477 2 2 6.477 2 12c0 4.418 2.865 8.166 6.839 9.49.5.09.682-.218.682-.482 0-.237-.009-.866-.013-1.7-2.782.603-3.369-1.34-3.369-1.34-.454-1.154-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.09-.647.35-1.087.636-1.337-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836a9.59 9.59 0 012.504.337c1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.202 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.163 22 16.418 22 12c0-5.523-4.477-10-10-10z" />
    </svg>
  );
}

function IconX() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.741l7.73-8.835L1.254 2.25H8.08l4.259 5.63 5.905-5.63zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
    </svg>
  );
}

function IconArxiv() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4" y="2" width="16" height="20" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 7h8M8 11h8M8 15h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function IconPolygon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M16.1 6.3l-2.8-1.62a2.6 2.6 0 00-2.6 0L7.9 6.3a2.6 2.6 0 00-1.3 2.25v3.24c0 .93.5 1.79 1.3 2.25l2.8 1.62c.8.46 1.8.46 2.6 0l2.8-1.62a2.6 2.6 0 001.3-2.25V8.55a2.6 2.6 0 00-1.3-2.25zM12 2L4 6.5v9L12 20l8-4.5v-9L12 2z" />
    </svg>
  );
}

export default function Footer(): JSX.Element {
  return (
    <>
      <style>{responsiveCSS}</style>
      <footer style={footerStyle}>
        <div style={containerStyle}>
          <div className="footer-grid">
            {/* Brand column */}
            <div>
              <Brand size="md" />
              <p style={brandBlurbStyle}>
                Permissionless, on-chain benchmark for AI forecasting agents. Open source under MIT.
              </p>
            </div>

            {/* Product column */}
            <div>
              <span style={colHeadStyle}>Product</span>
              <ul style={linkListStyle}>
                <li><NavLink to="/leaderboard" style={linkStyle}>Leaderboard</NavLink></li>
                <li><NavLink to="/arena" style={linkStyle}>Rounds</NavLink></li>
                <li>
                  <a href="https://github.com/foresight-arena/contracts" target="_blank" rel="noopener noreferrer" style={linkStyle}>
                    Contracts repo ↗
                  </a>
                </li>
                <li>
                  <a href="https://thegraph.com/studio/subgraph/foresight-arena/" target="_blank" rel="noopener noreferrer" style={linkStyle}>
                    Subgraph ↗
                  </a>
                </li>
              </ul>
            </div>

            {/* Build column */}
            <div>
              <span style={colHeadStyle}>Build</span>
              <ul style={linkListStyle}>
                <li>
                  <a href="https://github.com/foresight-arena/sdk#install" target="_blank" rel="noopener noreferrer" style={linkStyle}>
                    Submit an agent ↗
                  </a>
                </li>
                <li>
                  <a href="https://github.com/foresight-arena/sdk" target="_blank" rel="noopener noreferrer" style={linkStyle}>
                    SDK &amp; CLI ↗
                  </a>
                </li>
                <li>
                  <a href="https://github.com/foresight-arena/market-light-selection" target="_blank" rel="noopener noreferrer" style={linkStyle}>
                    Market selector ↗
                  </a>
                </li>
                <li>
                  <a href="https://github.com/foresight-arena/contracts#relayer-api" target="_blank" rel="noopener noreferrer" style={linkStyle}>
                    Relayer API ↗
                  </a>
                </li>
              </ul>
            </div>

            {/* Research column */}
            <div>
              <span style={colHeadStyle}>Research</span>
              <ul style={linkListStyle}>
                <li>
                  <a href="https://arxiv.org/abs/2605.00420" target="_blank" rel="noopener noreferrer" style={linkStyle}>
                    arXiv:2605.00420 ↗
                  </a>
                </li>
                <li>
                  <a href="https://www.foresightflow.org/" target="_blank" rel="noopener noreferrer" style={linkStyle}>
                    ForesightFlow ↗
                  </a>
                </li>
                <li>
                  <a href="https://www.foresightflow.org/publications" target="_blank" rel="noopener noreferrer" style={linkStyle}>
                    Publications ↗
                  </a>
                </li>
                <li>
                  <a href="https://www.foresightflow.org/datasets" target="_blank" rel="noopener noreferrer" style={linkStyle}>
                    Datasets ↗
                  </a>
                </li>
              </ul>
            </div>
          </div>

          {/* Bottom row */}
          <div style={bottomRowStyle}>
            <span style={copyrightStyle}>
              © 2026 Foresight Arena · MIT ·{' '}
              Research infrastructure by{' '}
              <a href="https://www.foresightflow.org/" target="_blank" rel="noopener noreferrer" style={fflowLinkStyle}>
                ForesightFlow
              </a>
            </span>
            <div style={socialsStyle}>
              <a href="https://github.com/foresight-arena" target="_blank" rel="noopener noreferrer" style={iconBtnStyle} aria-label="GitHub">
                <IconGitHub />
              </a>
              <a href="#" style={iconBtnStyle} aria-label="X (Twitter)">
                <IconX />
              </a>
              <a href="https://arxiv.org/abs/2605.00420" target="_blank" rel="noopener noreferrer" style={iconBtnStyle} aria-label="arXiv paper">
                <IconArxiv />
              </a>
              <a
                href="https://polygonscan.com/address/0xB81e4F6D37f036508F584B8e9Cc1dceA096D554d"
                target="_blank"
                rel="noopener noreferrer"
                style={iconBtnStyle}
                aria-label="Polygonscan"
              >
                <IconPolygon />
              </a>
            </div>
          </div>
        </div>
      </footer>
    </>
  );
}
