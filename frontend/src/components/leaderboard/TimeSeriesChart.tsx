import { useState, useMemo } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ChartAgent = {
  address: string;
  name: string;
  color: string;
  series: { roundId: number; cumAlpha: number; brier: number; scored: number }[];
};

type Props = {
  agents: ChartAgent[];
  metric: 'alpha' | 'brier';
};

// ─── Layout ───────────────────────────────────────────────────────────────────

const W = 800;
const H = 340;
const PAD_L = 56;
const PAD_R = 24;
const PAD_T = 20;
const PAD_B = 36;
const PLOT_W = W - PAD_L - PAD_R;
const PLOT_H = H - PAD_T - PAD_B;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function linspace(a: number, b: number, n: number): number[] {
  if (n <= 1) return [a];
  return Array.from({ length: n }, (_, i) => a + (i / (n - 1)) * (b - a));
}

function fmtAlpha(v: number): string {
  if (Math.abs(v) < 5e-5) return '0';
  const sign = v > 0 ? '+' : '−';
  return sign + Math.abs(v).toFixed(3);
}

function fmtBrier(v: number): string {
  return v.toFixed(3);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function TimeSeriesChart({ agents, metric }: Props) {
  const [hoveredAgent, setHoveredAgent] = useState<string | null>(null);

  const { xMin, xMax, yMin, yMax, xTicks, yTicks, hasData } = useMemo(() => {
    const agentsWithData = agents.filter(a => a.series.length >= 2);
    if (agentsWithData.length === 0) {
      return { xMin: 1, xMax: 1, yMin: 0, yMax: 1, xTicks: [], yTicks: [], hasData: false };
    }

    const allRoundIds = [...new Set(agentsWithData.flatMap(a => a.series.map(s => s.roundId)))].sort((a, b) => a - b);
    const xMin = allRoundIds[0];
    const xMax = allRoundIds[allRoundIds.length - 1];

    const allVals = agentsWithData.flatMap(a =>
      a.series.map(s => metric === 'alpha' ? s.cumAlpha : s.brier)
    );
    const rawMin = Math.min(...allVals);
    const rawMax = Math.max(...allVals);

    let yMin: number, yMax: number;
    if (metric === 'alpha') {
      yMin = Math.min(0, rawMin);
      yMax = Math.max(0, rawMax);
      if (yMin === yMax) { yMin -= 0.01; yMax += 0.01; }
    } else {
      yMin = 0;
      yMax = (rawMax * 1.1) || 0.5;
    }

    const yTicks = linspace(yMin, yMax, 5);

    const xTicks = allRoundIds.length <= 6
      ? allRoundIds
      : (() => {
          const step = Math.ceil(allRoundIds.length / 6);
          const picked = allRoundIds.filter((_, i) => i % step === 0);
          const last = allRoundIds[allRoundIds.length - 1];
          if (picked[picked.length - 1] !== last) picked.push(last);
          return picked;
        })();

    return { xMin, xMax, yMin, yMax, xTicks, yTicks, hasData: true };
  }, [agents, metric]);

  if (!hasData) {
    return (
      <div style={{
        height: 340, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'var(--fa-font-mono)', fontSize: 12, color: 'var(--fa-text-tertiary)',
      }}>
        Not enough data — agents need at least 2 scored rounds
      </div>
    );
  }

  const xScale = (rid: number) =>
    PAD_L + ((rid - xMin) / Math.max(1, xMax - xMin)) * PLOT_W;
  const yScale = (v: number) =>
    PAD_T + (1 - (v - yMin) / Math.max(1e-9, yMax - yMin)) * PLOT_H;

  const tooltipAgent = hoveredAgent ? agents.find(a => a.address === hoveredAgent) : null;
  const tooltipFinal = tooltipAgent?.series[tooltipAgent.series.length - 1];

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      {/* Tooltip — top-right corner, final value */}
      {tooltipAgent && tooltipFinal && (
        <div style={{
          position: 'absolute', top: 8, right: 8, zIndex: 10, pointerEvents: 'none',
          background: 'var(--fa-bg-card)', border: '1px solid var(--fa-border)',
          borderRadius: 6, padding: '8px 10px',
          fontFamily: 'var(--fa-font-mono)', fontSize: 11, color: 'var(--fa-text-primary)',
        }}>
          <div style={{ color: tooltipAgent.color, fontWeight: 500, marginBottom: 3 }}>
            {tooltipAgent.name}
          </div>
          <div>
            {metric === 'alpha' ? 'Cum α: ' : 'Brier: '}
            <strong>
              {metric === 'alpha' ? fmtAlpha(tooltipFinal.cumAlpha) : fmtBrier(tooltipFinal.brier)}
            </strong>
          </div>
          <div style={{ color: 'var(--fa-text-tertiary)', marginTop: 2 }}>R{tooltipFinal.roundId}</div>
        </div>
      )}

      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: 'auto', display: 'block' }}
        onMouseLeave={() => setHoveredAgent(null)}
      >
        {/* Y-axis grid lines + labels */}
        {yTicks.map((tick, i) => {
          const y = yScale(tick);
          const isZero = metric === 'alpha' && Math.abs(tick) < 1e-9;
          return (
            <g key={i}>
              <line
                x1={PAD_L} y1={y} x2={PAD_L + PLOT_W} y2={y}
                style={{
                  stroke: isZero ? 'var(--fa-border)' : 'var(--fa-border-soft)',
                  strokeWidth: isZero ? 1 : 0.5,
                }}
              />
              <text
                x={PAD_L - 6} y={y} dy="0.35em" textAnchor="end"
                style={{ fontFamily: 'var(--fa-font-mono)', fontSize: 10, fill: 'var(--fa-text-tertiary)' }}
              >
                {metric === 'alpha' ? fmtAlpha(tick) : fmtBrier(tick)}
              </text>
            </g>
          );
        })}

        {/* Extra zero line for alpha if not already on a tick */}
        {metric === 'alpha' && yMin < 0 && yMax > 0 &&
          !yTicks.some(t => Math.abs(t) < 1e-9) && (
          <line
            x1={PAD_L} y1={yScale(0)} x2={PAD_L + PLOT_W} y2={yScale(0)}
            style={{ stroke: 'var(--fa-border)', strokeWidth: 1 }}
          />
        )}

        {/* X-axis ticks + labels */}
        {xTicks.map(rid => {
          const x = xScale(rid);
          return (
            <g key={rid}>
              <line
                x1={x} y1={PAD_T + PLOT_H} x2={x} y2={PAD_T + PLOT_H + 4}
                style={{ stroke: 'var(--fa-border-soft)', strokeWidth: 0.5 }}
              />
              <text
                x={x} y={PAD_T + PLOT_H + 16} textAnchor="middle"
                style={{ fontFamily: 'var(--fa-font-mono)', fontSize: 10, fill: 'var(--fa-text-tertiary)' }}
              >
                R{rid}
              </text>
            </g>
          );
        })}

        {/* Agent lines */}
        {agents.map(agent => {
          const pts = agent.series;
          const isHovered = hoveredAgent === agent.address;
          const isDimmed = hoveredAgent !== null && !isHovered;

          if (pts.length < 2) {
            const pt = pts[0];
            if (!pt) return null;
            return (
              <g key={agent.address} onMouseEnter={() => setHoveredAgent(agent.address)} style={{ cursor: 'default' }}>
                <circle
                  cx={xScale(pt.roundId)}
                  cy={yScale(metric === 'alpha' ? pt.cumAlpha : pt.brier)}
                  r={4}
                  style={{ fill: agent.color, opacity: isDimmed ? 0.3 : 1, transition: 'opacity 120ms ease' }}
                />
              </g>
            );
          }

          const d = pts
            .map((pt, i) => {
              const x = xScale(pt.roundId).toFixed(2);
              const y = yScale(metric === 'alpha' ? pt.cumAlpha : pt.brier).toFixed(2);
              return `${i === 0 ? 'M' : 'L'} ${x},${y}`;
            })
            .join(' ');

          return (
            <g key={agent.address} onMouseEnter={() => setHoveredAgent(agent.address)} style={{ cursor: 'default' }}>
              {/* Wide transparent hit area */}
              <path d={d} fill="none" stroke="transparent" strokeWidth={12} />
              <path
                d={d}
                fill="none"
                style={{
                  stroke: agent.color,
                  strokeWidth: isHovered ? 3 : 2,
                  strokeLinejoin: 'round',
                  strokeLinecap: 'round',
                  opacity: isDimmed ? 0.3 : 1,
                  transition: 'opacity 120ms ease, stroke-width 80ms ease',
                }}
              />
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 20px', marginTop: 8, paddingLeft: PAD_L }}>
        {agents.map(agent => {
          const isDimmed = hoveredAgent !== null && hoveredAgent !== agent.address;
          return (
            <div
              key={agent.address}
              style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'default', opacity: isDimmed ? 0.4 : 1, transition: 'opacity 120ms ease' }}
              onMouseEnter={() => setHoveredAgent(agent.address)}
              onMouseLeave={() => setHoveredAgent(null)}
            >
              <div style={{ width: 10, height: 10, borderRadius: 2, background: agent.color, flexShrink: 0 }} />
              <span style={{ fontFamily: 'var(--fa-font-body)', fontSize: 12, color: 'var(--fa-text-secondary)' }}>
                {agent.name}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
