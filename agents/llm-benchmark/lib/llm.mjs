/**
 * LLM wrapper using Vercel AI SDK + OpenRouter.
 * Handles the tool-use loop and extracts final predictions via a sentinel tool.
 */

import { generateText, tool } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { z } from 'zod';

export async function getPredictions({ model, prompt, baseTools, marketCount, maxSteps = 20 }) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');

  const openrouter = createOpenRouter({ apiKey });

  let finalPredictions = null;
  let finalReasoning = null;

  // The submitPredictions tool captures the model's final answer.
  // We use this instead of parsing free-form text for reliable structured output.
  const submitTool = tool({
    description: `Submit your final predictions for all ${marketCount} markets. You MUST provide exactly ${marketCount} predictions, one per market index (0 to ${marketCount - 1}). Each prediction is a probability in basis points (0-10000). Call this tool ONCE when you are done researching.`,
    inputSchema: z.object({
      predictions: z
        .array(
          z.object({
            marketIndex: z.number().int().min(0).max(marketCount - 1),
            probabilityBps: z.number().int().min(0).max(10000),
            reasoning: z.string().describe('Brief reasoning (1-2 sentences)'),
          }),
        )
        .length(marketCount),
    }),
    execute: async ({ predictions }) => {
      finalPredictions = predictions;
      finalReasoning = predictions.map((p) => `[${p.marketIndex}] ${p.probabilityBps}: ${p.reasoning}`).join('\n');
      return { ok: true, message: 'Predictions submitted successfully.' };
    },
  });

  const tools = { ...baseTools, submitPredictions: submitTool };

  const result = await generateText({
    model: openrouter(model),
    tools,
    maxSteps,
    messages: [{ role: 'user', content: prompt }],
  });

  if (!finalPredictions) {
    throw new Error(`Model did not call submitPredictions after ${maxSteps} steps. Last text: ${result.text?.slice(0, 200)}`);
  }

  // Sort by marketIndex and return as plain array
  const sorted = [...finalPredictions].sort((a, b) => a.marketIndex - b.marketIndex);

  return {
    predictions: sorted.map((p) => p.probabilityBps),
    reasoning: finalReasoning,
    usage: result.usage,
  };
}
