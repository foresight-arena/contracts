/**
 * Minimal MCP client for Amazon Bedrock AgentCore Gateway.
 *
 * Only what the benchmark needs: `tools/list` (to discover the Web Search tool
 * name, which the Gateway prefixes with the target name, e.g.
 * `web-search-tool___WebSearch`) and `tools/call`. The Gateway's MCP endpoint is
 * stateless for these calls, so no `initialize` handshake/session is required.
 *
 * Inbound auth:
 *  - Gateway created with authorizer type AWS_IAM → requests are SigV4-signed
 *    (service `bedrock-agentcore`) with credentials from the default chain.
 *  - Gateway created with a JWT authorizer → pass `bearerToken` instead.
 */

import { AwsClient } from 'aws4fetch';
import { getAwsCredentials } from './aws.mjs';

const MAX_QUERY_CHARS = 200; // enforced by the Web Search connector

function regionFromGatewayUrl(url) {
  return url.match(/\.bedrock-agentcore\.([a-z0-9-]+)\.amazonaws\.com/)?.[1] || null;
}

/**
 * Parse a Streamable-HTTP MCP response: either a single JSON-RPC message or an
 * SSE stream whose `data:` events carry JSON-RPC messages.
 */
async function readRpcResponse(resp, id) {
  const contentType = resp.headers.get('content-type') || '';
  const body = await resp.text();
  if (!contentType.includes('text/event-stream')) return JSON.parse(body);

  for (const event of body.split(/\r?\n\r?\n/)) {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (!data) continue;
    const msg = JSON.parse(data);
    if (msg.id === id) return msg;
  }
  throw new Error('No JSON-RPC response in SSE stream');
}

export function createAgentCoreGateway({ gatewayUrl, region, bearerToken }) {
  if (!gatewayUrl) throw new Error('AgentCore gateway URL not set');
  const signingRegion = region || regionFromGatewayUrl(gatewayUrl) || process.env.AWS_REGION;
  if (!bearerToken && !signingRegion) {
    throw new Error('Cannot infer AgentCore region from gateway URL — set AGENTCORE_REGION');
  }

  let nextId = 1;

  async function rpc(method, params) {
    const id = nextId++;
    const init = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    };

    let resp;
    if (bearerToken) {
      init.headers.Authorization = `Bearer ${bearerToken}`;
      resp = await fetch(gatewayUrl, init);
    } else {
      // Fresh client per call so rotated temporary credentials are picked up
      const aws = new AwsClient({ ...(await getAwsCredentials()), service: 'bedrock-agentcore', region: signingRegion });
      resp = await aws.fetch(gatewayUrl, init);
    }

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`AgentCore Gateway ${method} failed: HTTP ${resp.status} ${text.slice(0, 200)}`);
    }
    const msg = await readRpcResponse(resp, id);
    if (msg.error) throw new Error(`AgentCore Gateway ${method} error: ${msg.error.message || JSON.stringify(msg.error)}`);
    return msg.result;
  }

  async function listTools() {
    const tools = [];
    let cursor;
    do {
      const result = await rpc('tools/list', cursor ? { cursor } : {});
      tools.push(...(result.tools || []));
      cursor = result.nextCursor;
    } while (cursor);
    return tools;
  }

  async function callTool(name, args) {
    return rpc('tools/call', { name, arguments: args });
  }

  return { listTools, callTool };
}

/**
 * Web search backed by the AgentCore Web Search connector.
 * Returns the same normalized shape as the Tavily backend.
 */
export function createAgentCoreWebSearch({ gatewayUrl, region, bearerToken, toolName, maxResults = 5 }) {
  const gateway = createAgentCoreGateway({ gatewayUrl, region, bearerToken });
  let resolvedName = toolName || null;

  async function resolveToolName() {
    if (resolvedName) return resolvedName;
    const tools = await gateway.listTools();
    const match = tools.find((t) => t.name === 'WebSearch' || t.name.endsWith('___WebSearch'));
    if (!match) {
      throw new Error(`No WebSearch tool on gateway (found: ${tools.map((t) => t.name).join(', ') || 'none'})`);
    }
    resolvedName = match.name;
    return resolvedName;
  }

  async function search(query) {
    const name = await resolveToolName();
    const result = await gateway.callTool(name, {
      query: query.slice(0, MAX_QUERY_CHARS),
      maxResults,
    });

    const text = (result.content || [])
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('\n');
    if (result.isError) throw new Error(text.slice(0, 200) || 'WebSearch returned an error');

    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = null; }
    const results = result.structuredContent?.results || parsed?.results;
    if (!Array.isArray(results)) return { answer: null, results: [{ title: null, url: null, snippet: text }] };

    return {
      answer: null,
      // Knowledge-graph hits come back with null title/url and the fact in `text`
      results: results.map((r) => ({
        title: r.title ?? null,
        url: r.url ?? null,
        snippet: r.text,
        publishedDate: r.publishedDate ?? null,
      })),
    };
  }

  // Startup check: confirms auth + that the gateway actually exposes the tool
  search.preflight = resolveToolName;
  return search;
}
