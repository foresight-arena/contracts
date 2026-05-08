import type { CSSProperties } from 'react';
import logoUrl from '../assets/logo.svg';

type Size = 'sm' | 'md' | 'lg';

const sizeMap: Record<Size, { mark: number; fontSize: number; gap: number }> = {
  sm: { mark: 24, fontSize: 18, gap: 12 },
  md: { mark: 32, fontSize: 22, gap: 14 },
  lg: { mark: 64, fontSize: 36, gap: 20 },
};

export function Brand({ size = 'sm' }: { size?: Size }) {
  const { mark, fontSize, gap } = sizeMap[size];

  const wrapStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap,
    textDecoration: 'none',
    color: 'var(--fa-text-primary)',
  };

  const imgStyle: CSSProperties = {
    width: mark,
    height: mark,
    display: 'block',
    flexShrink: 0,
  };

  const wordmarkStyle: CSSProperties = {
    fontFamily: 'var(--fa-font-display)',
    fontSize,
    fontWeight: 700,
    lineHeight: 1,
    letterSpacing: '-0.02em',
    color: 'var(--fa-text-primary)',
    whiteSpace: 'nowrap',
  };

  const normalStyle: CSSProperties = {
    fontVariationSettings: '"opsz" 144, "SOFT" 30',
  };

  const italicStyle: CSSProperties = {
    fontVariationSettings: '"opsz" 144, "SOFT" 30',
    color: 'var(--fa-gold)',
  };

  return (
    <span style={wrapStyle}>
      <img src={logoUrl} alt="" style={imgStyle} aria-hidden="true" />
      <span style={wordmarkStyle}>
        <span style={normalStyle}>Foresight </span>
        <span style={italicStyle}>Arena</span>
      </span>
    </span>
  );
}

export default Brand;
