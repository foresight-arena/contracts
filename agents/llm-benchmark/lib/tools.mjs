/**
 * Tool definitions for the LLM agent.
 *
 * Tools are scoped to a specific round — they reference the markets array
 * by index so the model never sees raw condition IDs.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { getPriceHistory } from './polymarket.mjs';

export function createTools({ markets, marketsRaw, tavilyKey }) {
  return {
    getMarketDetails: tool({
      description:
        'Get full details about a specific market including description, end date, current YES price, volume, liquidity, and tags. Use this to understand what a market is asking before predicting.',
      parameters: z.object({
        marketIndex: z.number().int().describe('The 0-based index of the market'),
      }),
      execute: async ({ marketIndex }) => {
        const m = marketsRaw[marketIndex];
        if (!m) return { error: 'Invalid market index' };

        let outcomePrices = m.outcomePrices;
        if (typeof outcomePrices === 'string') {
          try { outcomePrices = JSON.parse(outcomePrices); } catch { outcomePrices = []; }
        }

        const tags = (m.events?.[0]?.tags || [])
          .map((t) => t.label || t.slug)
          .filter(Boolean);

        return {
          question: m.question,
          description: m.description || null,
          endDate: m.endDateIso || m.endDate || null,
          closed: !!m.closed,
          currentYesPrice: outcomePrices?.[0] != null ? Number(outcomePrices[0]) : null,
          currentNoPrice: outcomePrices?.[1] != null ? Number(outcomePrices[1]) : null,
          volume: m.volume ? Number(m.volume) : null,
          liquidity: m.liquidity ? Number(m.liquidity) : null,
          tags,
          eventTitle: m.events?.[0]?.title || null,
        };
      },
    }),

    getPriceHistory: tool({
      description:
        'Get the recent price history (last week) for the YES outcome of a market. Returns up to ~30 data points showing how market sentiment has evolved.',
      parameters: z.object({
        marketIndex: z.number().int().describe('The 0-based index of the market'),
      }),
      execute: async ({ marketIndex }) => {
        const m = marketsRaw[marketIndex];
        if (!m) return { error: 'Invalid market index' };

        let tokenIds = m.clobTokenIds;
        if (typeof tokenIds === 'string') {
          try { tokenIds = JSON.parse(tokenIds); } catch { tokenIds = []; }
        }
        if (!Array.isArray(tokenIds) || tokenIds.length === 0) {
          return { error: 'No token IDs available for this market' };
        }

        const history = await getPriceHistory(tokenIds[0]);
        if (!history.length) return { error: 'No price history available' };

        // Sample at most 30 points
        const step = Math.max(1, Math.floor(history.length / 30));
        const sampled = history.filter((_, i) => i % step === 0);

        return {
          points: sampled.map((p) => ({
            timestamp: new Date(p.t * 1000).toISOString(),
            yesPrice: p.p,
          })),
        };
      },
    }),

    searchWeb: tool({
      description:
        'Search the web for current information. Use this to research recent news, statistics, or context relevant to a prediction market. Provide a focused query — return up to 5 results with snippets.',
      parameters: z.object({
        query: z.string().describe('The search query'),
      }),
      execute: async ({ query }) => {
        if (!tavilyKey) {
          return { error: 'Web search not configured (set TAVILY_API_KEY)' };
        }

        try {
          const resp = await fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              api_key: tavilyKey,
              query,
              max_results: 5,
              search_depth: 'basic',
              include_answer: true,
            }),
          });

          if (!resp.ok) {
            return { error: `Tavily API error: ${resp.status}` };
          }

          const data = await resp.json();
          return {
            answer: data.answer || null,
            results: (data.results || []).map((r) => ({
              title: r.title,
              url: r.url,
              snippet: r.content,
            })),
          };
        } catch (err) {
          return { error: `Search failed: ${err.message}` };
        }
      },
    }),
  };
}
