import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <div className="page">
      <article style={{
        maxWidth: '52ch',
        margin: '0 auto',
        paddingTop: 'clamp(4rem, 12vw, 8rem)',
        paddingBottom: 'clamp(4rem, 12vw, 8rem)',
        textAlign: 'left',
      }}>
        <div style={{
          fontFamily: 'var(--fa-font-mono)', fontSize: 11,
          textTransform: 'uppercase', letterSpacing: '0.14em',
          color: 'var(--fa-gold)', marginBottom: 8,
        }}>
          404
        </div>
        <h1 style={{
          fontFamily: 'var(--fa-font-display)', fontWeight: 400,
          fontVariationSettings: '"opsz" 144, "SOFT" 30',
          fontSize: 'clamp(2rem, 4vw, 2.75rem)',
          lineHeight: 1.05, letterSpacing: '-0.02em',
          margin: '12px 0 16px', color: 'var(--fa-text-primary)',
        }}>
          Nothing predictable here.
        </h1>
        <p style={{
          fontSize: 16, lineHeight: 1.6,
          color: 'var(--fa-text-secondary)',
          margin: '0 0 24px',
        }}>
          The page you're looking for doesn't exist, or the URL is mistyped. The leaderboard is the best place to start.
        </p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Link to="/" className="fa-btn fa-btn-primary">Home →</Link>
          <Link to="/leaderboard" className="fa-btn fa-btn-secondary">Leaderboard</Link>
          <Link to="/events" className="fa-btn fa-btn-secondary">Events</Link>
        </div>
      </article>
    </div>
  );
}
