import { useState, useEffect, type CSSProperties } from 'react';
import { fetchReasoning, type ReasoningData, type TraceStep } from '../services/reasoning';

interface Props {
  roundId: number;
  agent: string;
}

const panelStyle: CSSProperties = {
  marginTop: 'var(--space-sm)',
  padding: 'var(--space-md)',
  backgroundColor: 'var(--bg-secondary)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  fontSize: '0.8125rem',
};

const headerStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: 'var(--space-sm)',
};

const sectionTitleStyle: CSSProperties = {
  fontWeight: 600,
  fontSize: '0.75rem',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.05em',
  color: 'var(--text-secondary)',
  marginTop: 'var(--space-md)',
  marginBottom: 'var(--space-xs)',
};

const reasoningItemStyle: CSSProperties = {
  padding: 'var(--space-xs) 0',
  borderBottom: '1px solid var(--border)',
};

const toolCallStyle: CSSProperties = {
  padding: 'var(--space-xs) var(--space-sm)',
  marginBottom: 'var(--space-xs)',
  backgroundColor: 'var(--bg-tertiary)',
  borderRadius: 'var(--radius-sm)',
  fontSize: '0.75rem',
  overflow: 'auto',
};

function formatBps(bps: number): string {
  return (bps / 100).toFixed(1) + '%';
}

function ToolCallTrace({ trace }: { trace: TraceStep[] }) {
  const [expanded, setExpanded] = useState(false);

  const toolCalls = trace.flatMap((step) =>
    step.toolCalls.map((tc, i) => ({
      tool: tc.tool,
      args: tc.args,
      result: step.toolResults[i]?.result,
    })),
  ).filter((tc) => tc.tool !== 'submitPredictions');

  if (toolCalls.length === 0) return null;

  return (
    <div>
      <div style={sectionTitleStyle}>
        Tool Calls ({toolCalls.length})
        <button
          onClick={() => setExpanded(!expanded)}
          style={{
            marginLeft: 'var(--space-sm)',
            fontSize: '0.6875rem',
            color: 'var(--accent)',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            textTransform: 'lowercase',
          }}
        >
          {expanded ? 'collapse' : 'expand'}
        </button>
      </div>
      {expanded && toolCalls.map((tc, i) => (
        <div key={i} style={toolCallStyle}>
          <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{tc.tool}</span>
          <span style={{ color: 'var(--text-muted)' }}>(</span>
          <span className="mono" style={{ color: 'var(--text-secondary)' }}>
            {JSON.stringify(tc.args)}
          </span>
          <span style={{ color: 'var(--text-muted)' }}>)</span>
          {tc.result && (
            <details style={{ marginTop: 2 }}>
              <summary style={{ color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.6875rem' }}>
                result
              </summary>
              <pre style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--text-secondary)', fontSize: '0.6875rem' }}>
                {JSON.stringify(tc.result, null, 2)}
              </pre>
            </details>
          )}
        </div>
      ))}
    </div>
  );
}

export default function ReasoningPanel({ roundId, agent }: Props) {
  const [data, setData] = useState<ReasoningData | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [fetched, setFetched] = useState(false);

  useEffect(() => {
    if (!open || fetched) return;
    setLoading(true);
    fetchReasoning(roundId, agent)
      .then(setData)
      .finally(() => {
        setLoading(false);
        setFetched(true);
      });
  }, [open, fetched, roundId, agent]);

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        style={{
          fontSize: '0.6875rem',
          color: 'var(--accent)',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 0,
        }}
      >
        {open ? '[-] hide reasoning' : '[+] show reasoning'}
      </button>

      {open && (
        loading ? (
          <div style={{ ...panelStyle, color: 'var(--text-muted)' }}>Loading...</div>
        ) : !data ? (
          <div style={{ ...panelStyle, color: 'var(--text-muted)', fontStyle: 'italic' }}>No reasoning data available</div>
        ) : (
          <div style={panelStyle}>
            <div style={headerStyle}>
              <span>
                <span style={{ fontWeight: 600, color: 'var(--accent)' }}>{data.model}</span>
                {data.usage && (
                  <span style={{ marginLeft: 'var(--space-sm)', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                    {(data.usage.totalTokens || ((data.usage.promptTokens || 0) + (data.usage.completionTokens || 0))).toLocaleString()} tokens
                  </span>
                )}
              </span>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                {new Date(data.timestamp).toLocaleString()}
              </span>
            </div>

            {data.autoResolved.length > 0 && (
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 'var(--space-sm)' }}>
                Auto-resolved: {data.autoResolved.map((a) => `Market ${a.index} = ${a.outcome}`).join(', ')}
              </div>
            )}

            <div style={sectionTitleStyle}>Per-Market Reasoning</div>
            {data.perMarketReasoning.map((r) => (
              <div key={r.marketIndex} style={reasoningItemStyle}>
                <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                  [{r.marketIndex}] {formatBps(r.probabilityBps)}
                </span>
                <span style={{ marginLeft: 'var(--space-sm)', color: 'var(--text-secondary)' }}>
                  {r.reasoning}
                </span>
              </div>
            ))}

            {data.trace && data.trace.length > 0 && (
              <ToolCallTrace trace={data.trace} />
            )}
          </div>
        )
      )}
    </div>
  );
}
