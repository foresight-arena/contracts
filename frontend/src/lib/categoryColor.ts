export type CategoryStyle = { color: string; bg: string; border: string };

export const CATEGORY_VARIANTS: CategoryStyle[] = [
  { color: 'var(--fa-gold)',    bg: 'var(--fa-gold-bg)',       border: 'rgba(232,177,74,0.3)' },
  { color: 'var(--fa-teal)',    bg: 'var(--fa-teal-bg)',       border: 'rgba(93,191,176,0.3)' },
  { color: 'var(--fa-polygon)', bg: 'var(--fa-polygon-bg)',    border: 'rgba(130,71,229,0.3)' },
  { color: 'var(--fa-success)', bg: 'var(--fa-success-bg)',    border: 'rgba(116,196,118,0.3)' },
  { color: 'var(--fa-chart-5)', bg: 'rgba(232,154,111,0.12)', border: 'rgba(232,154,111,0.3)' },
];

export function styleForCategory(cat?: string): CategoryStyle | null {
  if (!cat) return null;
  const n = cat.toLowerCase().trim();
  let h = 0;
  for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0;
  return CATEGORY_VARIANTS[h % CATEGORY_VARIANTS.length];
}
