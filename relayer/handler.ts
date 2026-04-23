import type { CommitRequest, RevealRequest, RelayerResponse, HealthResponse, ReasoningRequest } from './lib/types.js';
import { verifyCommitSignature, verifyRevealSignature } from './lib/verify.js';
import { init, getRelayerAddress, getRelayerBalance, getAgentNonce, submitCommit, submitReveal, isAgentRegistered, submitRegister, recoverStrandedMint } from './lib/submit.js';
import { checkAndPostBenchmarks, checkAndTriggerOutcomes } from './lib/benchmarks.js';
import { verifyReasoningHash, uploadReasoning, getReasoning, hasRevealStartPassed, isOutcomesTriggeredSubgraph } from './lib/reasoning.js';
import { getAgentMetadata, getAgentImage } from './lib/metadata.js';
import { createChallenge, verifyTweetAndSign, VoucherError } from './lib/voucher.js';
import { config } from './config.js';
import { keccak256, encodePacked, recoverAddress, type Hex } from 'viem';

// Lazy init on first request
let initialized = false;

// Rate limit: track agent+round+action to prevent duplicates
const seen = new Map<string, number>();
const RATE_LIMIT_TTL = 3600_000; // 1 hour

function rateLimitKey(agent: string, roundId: number, action: string): string {
  return `${agent.toLowerCase()}-${roundId}-${action}`;
}

function isRateLimited(key: string): boolean {
  const ts = seen.get(key);
  return !!(ts && Date.now() - ts < RATE_LIMIT_TTL);
}

function markSeen(key: string): void {
  seen.set(key, Date.now());
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
  const commitKey = rateLimitKey(agent, roundId, 'commit');
  if (isRateLimited(commitKey)) {
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
  markSeen(commitKey);
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

  const revealKey = rateLimitKey(agent, roundId, 'reveal');
  if (isRateLimited(revealKey)) {
    return { success: false, error: 'Already submitted reveal for this round' };
  }

  const nonce = await getAgentNonce(agent as `0x${string}`);
  const valid = await verifyRevealSignature(body, nonce);
  if (!valid) {
    return { success: false, error: 'Invalid signature' };
  }

  const txHash = await submitReveal(body);
  markSeen(revealKey);
  return { success: true, txHash };
}

async function handleReasoning(body: ReasoningRequest): Promise<RelayerResponse & { key?: string; size?: number }> {
  const { roundId, agent, content } = body;

  if (roundId == null || !agent || content == null) {
    return { success: false, error: 'Missing required fields (roundId, agent, content)' };
  }

  // Timing gate: reject if round's revealStart hasn't passed yet
  const revealStarted = await hasRevealStartPassed(roundId);
  if (!revealStarted) {
    return { success: false, error: 'Reveal period has not started yet' };
  }

  // Verify reasoning content matches on-chain reasoningHash
  const valid = await verifyReasoningHash(roundId, agent, content);
  if (!valid) {
    return { success: false, error: 'Reasoning content does not match on-chain hash' };
  }

  try {
    const { key, size } = await uploadReasoning(roundId, agent, content);
    return { success: true, key, size };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
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
    console.log('Cron trigger: checking for pending benchmarks + outcomes');
    const benchmarkResults = await checkAndPostBenchmarks();
    const outcomeResults = await checkAndTriggerOutcomes();
    const results = [...benchmarkResults, ...outcomeResults];
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

    // Agent registration on canonical ERC-8004 Identity Registry (gasless via curator voucher)
    // Relayer mints the NFT to itself, then transfers to the agent.
    if (method === 'POST' && path === '/register') {
      const { agent, agentURI, voucher } = JSON.parse(
        event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString() : event.body || '{}'
      );
      if (!agent) return json(400, { success: false, error: 'Missing agent' });

      // Verify curator voucher
      if (!voucher || !voucher.signature || !voucher.expiry) {
        return json(400, { success: false, error: 'Missing voucher (curator approval required)' });
      }
      const now = Math.floor(Date.now() / 1000);
      if (Number(voucher.expiry) <= now) {
        return json(400, { success: false, error: 'Voucher expired' });
      }
      const voucherHash = keccak256(
        encodePacked(['address', 'uint256'], [agent as Hex, BigInt(voucher.expiry)])
      );
      const recoveredAddr = await recoverAddress({
        hash: voucherHash,
        signature: voucher.signature as Hex,
      });
      if (recoveredAddr.toLowerCase() !== config.curatorAddress.toLowerCase()) {
        return json(403, { success: false, error: 'Invalid voucher: not signed by curator' });
      }

      const already = await isAgentRegistered(agent as `0x${string}`);
      if (already) return json(200, { success: true, alreadyRegistered: true });

      try {
        const { txHash, agentId } = await submitRegister(
          agent as `0x${string}`,
          typeof agentURI === 'string' ? agentURI : '',
        );
        return json(200, { success: true, txHash, agentId: agentId.toString() });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('Register failed:', msg, err instanceof Error ? err.stack : '');
        if (msg.includes('insufficient funds')) return json(503, { success: false, error: 'Relayer wallet needs gas — contact the curator' });
        if (msg.includes('revert')) return json(400, { success: false, error: `Contract reverted: ${msg}` });
        return json(500, { success: false, error: `Registration failed: ${msg}` });
      }
    }

    // Recover a stranded mint (curator-only) — transfer relayer-owned NFT to the intended agent
    if (method === 'POST' && path === '/register/recover') {
      const { agent, agentId, curatorSignature } = JSON.parse(
        event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString() : event.body || '{}'
      );
      if (!agent || !agentId) return json(400, { error: 'Missing agent or agentId' });
      // Simple auth: require curator signature over the recovery params
      const recoverHash = keccak256(encodePacked(['address', 'uint256', 'string'], [agent as Hex, BigInt(agentId), 'recover']));
      const recovered = await recoverAddress({ hash: recoverHash, signature: curatorSignature as Hex });
      if (recovered.toLowerCase() !== config.curatorAddress.toLowerCase()) {
        return json(403, { error: 'Not authorized' });
      }
      try {
        const txHash = await recoverStrandedMint(agent as `0x${string}`, BigInt(agentId));
        return json(200, { success: true, txHash });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return json(500, { error: msg });
      }
    }

    // Voucher: request a challenge code
    if (method === 'POST' && path === '/voucher/challenge') {
      const { agent } = JSON.parse(
        event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString() : event.body || '{}'
      );
      if (!agent) return json(400, { error: 'Missing agent' });
      try {
        const result = await createChallenge(agent);
        return json(200, result);
      } catch (err) {
        if (err instanceof VoucherError) return json(err.status, { error: err.message });
        throw err;
      }
    }

    // Voucher: verify tweet and get signed voucher
    if (method === 'POST' && path === '/voucher/verify') {
      const { agent, tweetUrl } = JSON.parse(
        event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString() : event.body || '{}'
      );
      if (!agent || !tweetUrl) return json(400, { error: 'Missing agent or tweetUrl' });
      try {
        const voucher = await verifyTweetAndSign(agent, tweetUrl);
        return json(200, { voucher });
      } catch (err) {
        if (err instanceof VoucherError) return json(err.status, { error: err.message });
        throw err;
      }
    }

    // Manual benchmark posting trigger
    if (method === 'POST' && path === '/post-benchmarks') {
      const results = await checkAndPostBenchmarks();
      return json(200, { results });
    }

    // Reasoning lookup — fetch posted reasoning JSON for a (round, agent) pair
    // Only serve after outcomes have been triggered for the round
    if (method === 'GET' && path.startsWith('/reasoning/')) {
      const parts = path.replace('/reasoning/', '').split('/');
      if (parts.length !== 2) return json(400, { error: 'Expected /reasoning/{roundId}/{agent}' });
      const [roundIdStr, agent] = parts;
      const roundId = Number(roundIdStr);
      if (!Number.isInteger(roundId) || roundId < 0) return json(400, { error: 'Invalid roundId' });
      if (!/^0x[0-9a-fA-F]{40}$/.test(agent)) return json(400, { error: 'Invalid agent address' });

      const triggered = await isOutcomesTriggeredSubgraph(roundId);
      if (!triggered) return json(403, { error: 'Reasoning not available until outcomes are triggered' });

      const content = await getReasoning(roundId, agent);
      if (content == null) return json(404, { error: 'Not found' });
      return json(200, content);
    }

    // Agent metadata (OpenSea-compatible), looked up by address
    if (method === 'GET' && path.match(/^\/agent\/0x[0-9a-fA-F]{40}$/)) {
      const address = path.replace('/agent/', '');
      const metadata = await getAgentMetadata(address);
      if (!metadata) return json(404, { error: 'Agent not found' });
      return json(200, metadata);
    }

    // Agent dynamic SVG image, looked up by address
    if (method === 'GET' && path.match(/^\/agent\/0x[0-9a-fA-F]{40}\/image$/)) {
      const address = path.replace('/agent/', '').replace('/image', '');
      const svg = await getAgentImage(address);
      if (!svg) return json(404, { error: 'Agent not found' });
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'image/svg+xml',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=300',
        },
        body: svg,
      };
    }

    // Polymarket API proxy (avoids CORS for frontend)
    if (method === 'GET' && path.startsWith('/polymarket/')) {
      const subpath = path.replace('/polymarket/', '');
      const queryString = event.rawQueryString || '';
      const url = `https://gamma-api.polymarket.com/${subpath}${queryString ? '?' + queryString : ''}`;
      const resp = await fetch(url);
      let data = await resp.json();

      // Fallback: gamma API excludes closed markets by default — retry with closed=true
      if (Array.isArray(data) && data.length === 0 && subpath === 'markets' && !queryString.includes('closed=')) {
        const closedResp = await fetch(`${url}&closed=true`);
        data = await closedResp.json();
      }

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

      if (path === '/reasoning') {
        const result = await handleReasoning(body as ReasoningRequest);
        return json(result.success ? 200 : 400, result);
      }
    }

    return json(404, { error: 'Not found' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : '';
    console.error('Handler error:', message, stack);

    // Surface contract reverts and common errors; hide raw internals
    let safeMessage = 'Internal error';
    if (message.includes('revert')) safeMessage = message;
    else if (message.includes('insufficient funds')) safeMessage = 'Relayer wallet has insufficient funds for gas';
    else if (message.includes('nonce')) safeMessage = 'Transaction nonce conflict — retry in a few seconds';
    else if (message.includes('timeout')) safeMessage = 'RPC request timed out — retry';
    return json(500, { success: false, error: safeMessage });
  }
}
