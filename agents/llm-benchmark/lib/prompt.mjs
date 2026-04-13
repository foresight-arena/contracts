/**
 * Prompt template for the LLM benchmark agent.
 * Same prompt is used across all models for fair comparison.
 */

export function buildPrompt({ roundId, round, summaries, hasWebSearch }) {
  const marketLines = summaries
    .map((s) => {
      if (s.error) return `[${s.index}] ${s.error}`;
      const price = s.currentYesPrice != null ? `${(s.currentYesPrice * 100).toFixed(1)}%` : 'unknown';
      const tags = s.tags.length ? ` (tags: ${s.tags.join(', ')})` : '';
      const ends = s.endDate ? ` ends ${s.endDate.split('T')[0]}` : '';
      return `[${s.index}] ${s.question || 'Unknown'}${tags} — current YES: ${price}${ends}`;
    })
    .join('\n');

  const tools = [
    '- getMarketDetails(marketIndex) — full description, volume, liquidity, end date',
    '- getPriceHistory(marketIndex) — recent YES price history (last week)',
  ];
  if (hasWebSearch) {
    tools.push('- searchWeb(query) — search the web for current news and context');
  }
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
