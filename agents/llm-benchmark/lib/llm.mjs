/**
 * LLM wrapper using Vercel AI SDK with a pluggable provider (OpenRouter or Amazon Bedrock).
 * Handles the tool-use loop and extracts final predictions via a sentinel tool.
 */

import { generateText, tool } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { z } from 'zod';
import { getAwsCredentials } from './aws.mjs';

export const LLM_PROVIDERS = ['openrouter', 'bedrock'];

/**
 * Resolve a provider + model ID into an AI SDK language model.
 *  - openrouter: MODEL is an OpenRouter slug (e.g. `anthropic/claude-opus-4`)
 *  - bedrock:    MODEL is a Bedrock model ID, inference profile ID or ARN
 *                (e.g. `us.anthropic.claude-sonnet-4-5-20250929-v1:0`); the model
 *                must support tool use via the Converse API.
 */
function createModel(provider, model) {
  switch (provider) {
    case 'openrouter': {
      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');
      return createOpenRouter({ apiKey })(model);
    }
    case 'bedrock': {
      const bedrock = createAmazonBedrock({
        region: process.env.BEDROCK_REGION || process.env.AWS_REGION || 'us-east-1',
        credentialProvider: getAwsCredentials,
      });
      return bedrock(model);
    }
    default:
      throw new Error(`Unknown LLM provider: ${provider}`);
  }
}

export async function getPredictions({ provider = 'openrouter', model, prompt, baseTools, marketCount, maxSteps = 20 }) {

  let finalPredictions = null;
  let finalReasoning = null;

  // The submitPredictions tool captures the model's final answer.
  // We use this instead of parsing free-form text for reliable structured output.
  const submitTool = tool({
    description: `Submit your final predictions for all ${marketCount} markets. You MUST provide exactly ${marketCount} predictions, one per market index (0 to ${marketCount - 1}). Each prediction is a probability in basis points (0-10000). Call this tool ONCE when you are done researching.`,
    parameters: z.object({
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
    model: createModel(provider, model),
    tools,
    maxSteps,
    messages: [{ role: 'user', content: prompt }],
  });

  if (!finalPredictions) {
    throw new Error(`Model did not call submitPredictions after ${maxSteps} steps. Last text: ${result.text?.slice(0, 200)}`);
  }

  // Sort by marketIndex and return as plain array
  const sorted = [...finalPredictions].sort((a, b) => a.marketIndex - b.marketIndex);

  // Flatten all steps into a serializable trace (tool calls + responses + text)
  const trace = (result.steps || []).map((step, i) => ({
    step: i,
    text: step.text || null,
    toolCalls: (step.toolCalls || []).map((tc) => ({
      tool: tc.toolName,
      args: tc.args,
    })),
    toolResults: (step.toolResults || []).map((tr) => ({
      tool: tr.toolName,
      result: tr.result,
    })),
    finishReason: step.finishReason || null,
    usage: step.usage || null,
  }));

  return {
    predictions: sorted.map((p) => p.probabilityBps),
    reasoning: finalReasoning,
    perMarketReasoning: sorted.map((p) => ({
      marketIndex: p.marketIndex,
      probabilityBps: p.probabilityBps,
      reasoning: p.reasoning,
    })),
    trace,
    usage: result.usage,
  };
}
