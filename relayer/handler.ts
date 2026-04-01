import type { CommitRequest, RevealRequest, RelayerResponse, HealthResponse } from './lib/types.js';
import { verifyCommitSignature, verifyRevealSignature } from './lib/verify.js';
import { init, getRelayerAddress, getRelayerBalance, getAgentNonce, submitCommit, submitReveal } from './lib/submit.js';
import { checkAndPostBenchmarks } from './lib/benchmarks.js';

// Lazy init on first request
let initialized = false;

// Rate limit: track agent+round+action to prevent duplicates
const seen = new Map<string, number>();
const RATE_LIMIT_TTL = 3600_000; // 1 hour

function rateLimitKey(agent: string, roundId: number, action: string): string {
  return `${agent.toLowerCase()}-${roundId}-${action}`;
}

function checkRateLimit(key: string): boolean {
  const ts = seen.get(key);
  if (ts && Date.now() - ts < RATE_LIMIT_TTL) return false;
  seen.set(key, Date.now());
  return true;
}

// Clean stale entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, ts] of seen) {
    if (now - ts > RATE_LIMIT_TTL) seen.delete(key);
  }
}, 600_000);

function json(statusCode: number, body: unknown): { statusCode: number; headers: Record<string, string>; body: string } {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
    body: JSON.stringify(body),
  };
}

async function handleCommit(body: CommitRequest): Promise<RelayerResponse> {
  const { roundId, commitHash, agent, deadline, signature } = body;

  // Validate fields
  if (!roundId || !commitHash || !agent || !deadline || !signature) {
    return { success: false, error: 'Missing required fields' };
  }

  // Check deadline
  const now = Math.floor(Date.now() / 1000);
  if (deadline < now + 30) {
    return { success: false, error: 'Deadline too close or expired' };
  }

  // Rate limit
  if (!checkRateLimit(rateLimitKey(agent, roundId, 'commit'))) {
    return { success: false, error: 'Already submitted commit for this round' };
  }

  // Verify signature off-chain
  const nonce = await getAgentNonce(agent as `0x${string}`);
  const valid = await verifyCommitSignature(body, nonce);
  if (!valid) {
    return { success: false, error: 'Invalid signature' };
  }

  // Simulate and submit
  const txHash = await submitCommit(body);
  return { success: true, txHash };
}

async function handleReveal(body: RevealRequest): Promise<RelayerResponse> {
  const { roundId, predictions, salt, agent, deadline, signature } = body;

  if (!roundId || !predictions || !salt || !agent || !deadline || !signature) {
    return { success: false, error: 'Missing required fields' };
  }

  const now = Math.floor(Date.now() / 1000);
  if (deadline < now + 30) {
    return { success: false, error: 'Deadline too close or expired' };
  }

  if (!checkRateLimit(rateLimitKey(agent, roundId, 'reveal'))) {
    return { success: false, error: 'Already submitted reveal for this round' };
  }

  const nonce = await getAgentNonce(agent as `0x${string}`);
  const valid = await verifyRevealSignature(body, nonce);
  if (!valid) {
    return { success: false, error: 'Invalid signature' };
  }

  const txHash = await submitReveal(body);
  return { success: true, txHash };
}

async function handleHealth(): Promise<HealthResponse> {
  return {
    status: 'ok',
    relayerAddress: getRelayerAddress(),
    balance: await getRelayerBalance(),
    chain: 'polygon',
  };
}

// Lambda handler (Function URL + EventBridge cron)
export async function handler(event: {
  requestContext?: { http?: { method: string; path: string } };
  rawPath?: string;
  httpMethod?: string;
  path?: string;
  body?: string;
  isBase64Encoded?: boolean;
  rawQueryString?: string;
  source?: string;         // EventBridge sets this to 'aws.events'
  'detail-type'?: string;  // EventBridge scheduled event
}) {
  // EventBridge cron trigger — run benchmark poster
  if (event.source === 'aws.events' || event['detail-type'] === 'Scheduled Event') {
    console.log('Cron trigger: checking for pending benchmarks');
    const results = await checkAndPostBenchmarks();
    console.log(results.join('\n'));
    return { statusCode: 200, body: JSON.stringify({ results }) };
  }

  const method = event.requestContext?.http?.method || event.httpMethod || 'GET';
  const path = event.rawPath || event.path || '/';

  // Init on first invocation
  if (!initialized) {
    init();
    initialized = true;
  }

  // CORS preflight
  if (method === 'OPTIONS') {
    return json(200, {});
  }

  try {
    if (method === 'GET' && path === '/health') {
      return json(200, await handleHealth());
    }

    // Nonce lookup — agents can query without RPC
    if (method === 'GET' && path.startsWith('/nonce/')) {
      const agent = path.replace('/nonce/', '') as `0x${string}`;
      const nonce = await getAgentNonce(agent);
      return json(200, { agent, nonce: nonce.toString() });
    }

    // Manual benchmark posting trigger
    if (method === 'POST' && path === '/post-benchmarks') {
      const results = await checkAndPostBenchmarks();
      return json(200, { results });
    }

    // Polymarket API proxy (avoids CORS for frontend)
    if (method === 'GET' && path.startsWith('/polymarket/')) {
      const subpath = path.replace('/polymarket/', '');
      const queryString = event.rawQueryString || '';
      const url = `https://gamma-api.polymarket.com/${subpath}${queryString ? '?' + queryString : ''}`;
      const resp = await fetch(url);
      const data = await resp.json();
      return json(resp.status, data);
    }

    if (method === 'POST') {
      const rawBody = event.isBase64Encoded
        ? Buffer.from(event.body || '', 'base64').toString()
        : event.body || '{}';
      const body = JSON.parse(rawBody);

      if (path === '/commit') {
        const result = await handleCommit(body as CommitRequest);
        return json(result.success ? 200 : 400, result);
      }

      if (path === '/reveal') {
        const result = await handleReveal(body as RevealRequest);
        return json(result.success ? 200 : 400, result);
      }
    }

    return json(404, { error: 'Not found' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Handler error:', message);

    // Don't leak internal errors
    const safeMessage = message.includes('revert')
      ? message  // contract reverts are useful to the caller
      : 'Internal error';
    return json(500, { success: false, error: safeMessage });
  }
}
