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

/**
 * Bedrock prompt caching. Only Claude and Nova accept cache points — other
 * Bedrock models reject them — so `auto` enables it by model family.
 * BEDROCK_PROMPT_CACHE=on|off overrides.
 */
function usePromptCache(provider, model) {
  if (provider !== 'bedrock') return false;
  const mode = (process.env.BEDROCK_PROMPT_CACHE || 'auto').toLowerCase();
  if (mode === 'on') return true;
  if (mode === 'off') return false;
  return /anthropic\.claude|amazon\.nova/.test(model);
}

const CACHE_POINT = { bedrock: { cachePoint: { type: 'default' } } };

/**
 * Each step re-sends the whole conversation, so tool results (search snippets)
 * from early steps are paid for again on every later step. Put cache points on
 * the prompt and the two most recent tool-result messages: the older one is read
 * from cache, the newest is written for the next step. Bedrock allows at most 4.
 */
function placeCachePoints(messages) {
  const toolIdx = messages.flatMap((m, i) => (m.role === 'tool' ? [i] : []));
  const keep = new Set([0, ...toolIdx.slice(-2)]);
  messages.forEach((m, i) => {
    if (keep.has(i)) m.providerOptions = CACHE_POINT;
    else delete m.providerOptions;
  });
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

  const llm = createModel(provider, model);
  const cache = usePromptCache(provider, model);
  const messages = [{ role: 'user', content: prompt }];
  const steps = [];

  // Tool loop driven one step at a time (instead of `maxSteps`) so cache points
  // can be moved onto the newest messages before each call.
  while (steps.length < maxSteps) {
    if (cache) placeCachePoints(messages);
    const res = await generateText({ model: llm, tools, messages });
    const step = res.steps[0];
    steps.push(step);
    messages.push(...res.response.messages);
    // Stop as soon as the answer is in — no need to pay for a closing summary
    if (finalPredictions || step.finishReason !== 'tool-calls') break;
  }

  if (!finalPredictions) {
    throw new Error(`Model did not call submitPredictions after ${steps.length} steps. Last text: ${steps.at(-1)?.text?.slice(0, 200)}`);
  }

  // Sort by marketIndex and return as plain array
  const sorted = [...finalPredictions].sort((a, b) => a.marketIndex - b.marketIndex);

  // Flatten all steps into a serializable trace (tool calls + responses + text)
  const trace = steps.map((step, i) => ({
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
    cache: cacheUsage(step),
  }));

  const usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  for (const step of trace) {
    for (const k of Object.keys(usage)) usage[k] += step.usage?.[k] || 0;
    if (step.cache) {
      usage.cacheReadTokens = (usage.cacheReadTokens || 0) + step.cache.readTokens;
      usage.cacheWriteTokens = (usage.cacheWriteTokens || 0) + step.cache.writeTokens;
    }
  }

  return {
    predictions: sorted.map((p) => p.probabilityBps),
    reasoning: finalReasoning,
    perMarketReasoning: sorted.map((p) => ({
      marketIndex: p.marketIndex,
      probabilityBps: p.probabilityBps,
      reasoning: p.reasoning,
    })),
    trace,
    usage,
  };
}

function cacheUsage(step) {
  const u = step.providerMetadata?.bedrock?.usage;
  if (!u) return null;
  return { readTokens: u.cacheReadInputTokens || 0, writeTokens: u.cacheWriteInputTokens || 0 };
}
