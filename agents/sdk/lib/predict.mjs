/**
 * LLM prediction engine — adapted from agents/llm-benchmark.
 * Uses Vercel AI SDK + OpenRouter for multi-model support.
 * Optional dependency: only needed if running predict.mjs.
 */

import { getPriceHistory } from './markets.mjs';

// ─── Prompt ──────────────────────────────────────────────────────────────────

export function buildPrompt({ roundId, round, summaries, hasWebSearch }) {
  const marketLines = summaries
    .map((s) => {
      if (s.error) return `[${s.index}] ${s.error}`;
      const price = s.currentYesPrice != null ? `${(s.currentYesPrice * 100).toFixed(1)}%` : 'unknown';
      const tags = s.tags?.length ? ` (tags: ${s.tags.join(', ')})` : '';
      const ends = s.endDate ? ` ends ${s.endDate.split('T')[0]}` : '';
      return `[${s.index}] ${s.question || 'Unknown'}${tags} — current YES: ${price}${ends}`;
    })
    .join('\n');

  const tools = [
    '- getMarketDetails(marketIndex) — full description, volume, liquidity, end date',
    '- getPriceHistory(marketIndex) — recent YES price history (last week)',
  ];
  if (hasWebSearch) tools.push('- searchWeb(query) — search the web for current news and context');
  tools.push('- submitPredictions(predictions) — submit your final answer (call this LAST)');

  return `You are competing in an on-chain prediction tournament called Foresight Arena. Your goal is to forecast the outcomes of real-world prediction markets BETTER than the current market consensus.

# Round ${roundId}
You are predicting ${summaries.length} markets. Reveal deadline: ${new Date(Number(round.revealDeadline) * 1000).toISOString()}.

# Markets
${marketLines}

# Output format
For each market, output a probability that it will resolve YES, expressed in basis points:
- 0 = certain NO
- 5000 = exactly 50/50
- 10000 = certain YES

# Scoring
You are scored using two metrics:
- **Brier score** (lower = better): mean squared error vs. true outcome
- **Alpha score** (higher = better): how much you outperform the market consensus shown above

Beating the market means you should NOT just copy the current YES price. You need to identify cases where you have better information or judgment than the market.

# Available tools
${tools.join('\n')}

# Strategy
1. Look at each market's question and current price
2. For markets where you're uncertain or want more context, use getMarketDetails
3. For markets where momentum matters, use getPriceHistory
${hasWebSearch ? '4. For markets where current events matter, use searchWeb to research recent news\n' : ''}${hasWebSearch ? '5' : '4'}. Once you have predictions for ALL ${summaries.length} markets, call submitPredictions with the full list

Do not call submitPredictions until you have predictions for all markets. Your reasoning field is logged but not used for scoring — keep it brief.`;
}

// ─── Tools ───────────────────────────────────────────────────────────────────

export function createTools({ marketsRaw, tavilyKey }) {
  // Lazy import — these are optional deps
  let toolFn, zod;
  try {
    ({ tool: toolFn } = await import('ai'));
    ({ z: zod } = await import('zod'));
  } catch {
    throw new Error('predict requires optional deps: npm install ai @ai-sdk/openai');
  }

  return {
    getMarketDetails: toolFn({
      description: 'Get full details about a specific market.',
      parameters: zod.object({ marketIndex: zod.number().int() }),
      execute: async ({ marketIndex }) => {
        const m = marketsRaw[marketIndex];
        if (!m) return { error: 'Invalid market index' };
        let outcomePrices = m.outcomePrices;
        if (typeof outcomePrices === 'string') try { outcomePrices = JSON.parse(outcomePrices); } catch { outcomePrices = []; }
        return {
          question: m.question,
          description: m.description || null,
          endDate: m.endDateIso || m.endDate || null,
          closed: !!m.closed,
          currentYesPrice: outcomePrices?.[0] != null ? Number(outcomePrices[0]) : null,
          volume: m.volume ? Number(m.volume) : null,
          liquidity: m.liquidity ? Number(m.liquidity) : null,
          tags: (m.events?.[0]?.tags || []).map((t) => t.label || t.slug).filter(Boolean),
        };
      },
    }),

    getPriceHistory: toolFn({
      description: 'Get recent price history (last week) for the YES outcome of a market.',
      parameters: zod.object({ marketIndex: zod.number().int() }),
      execute: async ({ marketIndex }) => {
        const m = marketsRaw[marketIndex];
        if (!m) return { error: 'Invalid market index' };
        let tokenIds = m.clobTokenIds;
        if (typeof tokenIds === 'string') try { tokenIds = JSON.parse(tokenIds); } catch { tokenIds = []; }
        if (!Array.isArray(tokenIds) || !tokenIds.length) return { error: 'No token IDs' };
        const history = await getPriceHistory(tokenIds[0]);
        if (!history.length) return { error: 'No price history' };
        const step = Math.max(1, Math.floor(history.length / 30));
        return { points: history.filter((_, i) => i % step === 0).map((p) => ({ timestamp: new Date(p.t * 1000).toISOString(), yesPrice: p.p })) };
      },
    }),

    searchWeb: toolFn({
      description: 'Search the web for current information relevant to a prediction.',
      parameters: zod.object({ query: zod.string() }),
      execute: async ({ query }) => {
        if (!tavilyKey) return { error: 'Web search not configured (set TAVILY_API_KEY)' };
        try {
          const resp = await fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ api_key: tavilyKey, query, max_results: 5, search_depth: 'basic', include_answer: true }),
          });
          if (!resp.ok) return { error: `Tavily API error: ${resp.status}` };
          const data = await resp.json();
          return { answer: data.answer || null, results: (data.results || []).map((r) => ({ title: r.title, url: r.url, snippet: r.content })) };
        } catch (err) { return { error: `Search failed: ${err.message}` }; }
      },
    }),
  };
}

// ─── LLM Call ────────────────────────────────────────────────────────────────

export async function getPredictions({ model, prompt, baseTools, marketCount, maxSteps = 20 }) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');

  let generateText, toolFn, zod, createOpenRouter;
  try {
    ({ generateText } = await import('ai'));
    ({ tool: toolFn } = await import('ai'));
    ({ z: zod } = await import('zod'));
    ({ createOpenRouter } = await import('@openrouter/ai-sdk-provider'));
  } catch {
    throw new Error('predict requires: npm install ai @ai-sdk/openai @openrouter/ai-sdk-provider zod');
  }

  const openrouter = createOpenRouter({ apiKey });
  let finalPredictions = null;

  const submitTool = toolFn({
    description: `Submit your final predictions for all ${marketCount} markets. Provide exactly ${marketCount} predictions. Call this ONCE when done.`,
    parameters: zod.object({
      predictions: zod.array(zod.object({
        marketIndex: zod.number().int().min(0).max(marketCount - 1),
        probabilityBps: zod.number().int().min(0).max(10000),
        reasoning: zod.string(),
      })).length(marketCount),
    }),
    execute: async ({ predictions }) => { finalPredictions = predictions; return { ok: true }; },
  });

  const result = await generateText({
    model: openrouter(model),
    tools: { ...baseTools, submitPredictions: submitTool },
    maxSteps,
    messages: [{ role: 'user', content: prompt }],
  });

  if (!finalPredictions) throw new Error(`Model did not call submitPredictions after ${maxSteps} steps`);

  const sorted = [...finalPredictions].sort((a, b) => a.marketIndex - b.marketIndex);
  return {
    predictions: sorted.map((p) => p.probabilityBps),
    perMarketReasoning: sorted.map((p) => ({ marketIndex: p.marketIndex, probabilityBps: p.probabilityBps, reasoning: p.reasoning })),
    usage: result.usage,
  };
}
