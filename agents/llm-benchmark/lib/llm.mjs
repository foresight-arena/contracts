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
 * Bedrock prompt caching policy by model family:
 *  - 'full':   prompt + newest tool-result messages (Claude)
 *  - 'prompt': prompt only — Nova rejects cache points inside tool-result messages
 *              ("extraneous key [cachePoint] is not permitted")
 *  - 'none':   other models reject cache points entirely
 * BEDROCK_PROMPT_CACHE=on (full) | off overrides `auto`.
 */
function promptCacheMode(provider, model) {
  if (provider !== 'bedrock') return 'none';
  const mode = (process.env.BEDROCK_PROMPT_CACHE || 'auto').toLowerCase();
  if (mode === 'on') return 'full';
  if (mode === 'off') return 'none';
  if (/anthropic\.claude/.test(model)) return 'full';
  if (/amazon\.nova/.test(model)) return 'prompt';
  return 'none';
}

const CACHE_POINT = { bedrock: { cachePoint: { type: 'default' } } };

/**
 * Each step re-sends the whole conversation, so tool results (search snippets)
 * from early steps are paid for again on every later step. Put cache points on
 * the prompt and the two most recent tool-result messages: the older one is read
 * from cache, the newest is written for the next step. Bedrock allows at most 4.
 */
function placeCachePoints(messages, mode) {
  const toolIdx = mode === 'full' ? messages.flatMap((m, i) => (m.role === 'tool' ? [i] : [])) : [];
  const keep = new Set(mode === 'none' ? [] : [0, ...toolIdx.slice(-2)]);
  messages.forEach((m, i) => {
    if (keep.has(i)) m.providerOptions = CACHE_POINT;
    else delete m.providerOptions;
  });
}

const isCachePointRejection = (err) => /cachePoint/i.test(err?.message || '');

/**
 * `deadline` (ms epoch, optional): the latest moment the loop may still be
 * talking to the model — the caller reserves time after it to commit. Checked
 * before every step and enforced mid-call with an abort signal.
 */
export async function getPredictions({ provider = 'openrouter', model, prompt, baseTools, marketCount, maxSteps = 20, deadline = null, log = () => {} }) {
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
  let cacheMode = promptCacheMode(provider, model);
  const messages = [{ role: 'user', content: prompt }];
  const steps = [];

  // Tool loop driven one step at a time (instead of `maxSteps`) so cache points
  // can be moved onto the newest messages before each call.
  const outOfTime = () => new Error(`Out of time: stopped before the commit deadline after ${steps.length} step(s)`);
  const call = () => {
    if (deadline == null) return generateText({ model: llm, tools, messages });
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw outOfTime();
    return generateText({ model: llm, tools, messages, abortSignal: AbortSignal.timeout(remaining) });
  };

  while (steps.length < maxSteps) {
    placeCachePoints(messages, cacheMode);
    let res;
    try {
      res = await call();
    } catch (err) {
      if (err.name === 'TimeoutError' || err.name === 'AbortError') throw outOfTime();
      // A model that rejects cache points must not cost the round: retry this
      // step uncached and keep caching off for the rest of the run. Safe to
      // retry — tools only execute after a successful model response.
      if (cacheMode === 'none' || !isCachePointRejection(err)) throw err;
      log(`Prompt caching rejected by ${model} (${err.message.slice(0, 120)}) — retrying without cache`);
      cacheMode = 'none';
      placeCachePoints(messages, cacheMode);
      try {
        res = await call();
      } catch (err2) {
        if (err2.name === 'TimeoutError' || err2.name === 'AbortError') throw outOfTime();
        throw err2;
      }
    }
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
