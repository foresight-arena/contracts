/**
 * Registration input validation + agentURI builder.
 *
 * The /register endpoint takes structured metadata fields and assembles
 * the on-chain agentURI server-side as an inline data:application/json;base64
 * blob. Callers can no longer pass an arbitrary URI — that path was the
 * source of "agent registered with a GitHub HTML URL" bugs.
 */

const SUBGRAPH = process.env.SUBGRAPH_URL || 'https://api.studio.thegraph.com/query/1745354/foresight-arena/version/latest';
const RELAYER_BASE = process.env.RELAYER_BASE_URL || 'https://api.foresightarena.xyz';
const PLATFORM_URL = 'https://foresightarena.xyz';
const IDENTITY_REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';

const NAME_MIN = 1;
const NAME_MAX = 64;
const DESCRIPTION_MIN = 1;
const DESCRIPTION_MAX = 2048;

export interface RegistrationInput {
  agent: string;        // 0x... required
  name: string;         // required, unique across registry
  description: string;  // required
  image?: string;       // optional, defaults to ${RELAYER_BASE}/agent/{addr}/image
  externalUrl?: string; // optional, defaults to ${PLATFORM_URL}/agent/{addr}
}

export interface ValidatedInput {
  agent: `0x${string}`;
  name: string;
  description: string;
  image: string;
  externalUrl: string;
}

export class ValidationError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Sync field validation. Throws ValidationError(400) on bad input.
 * Does NOT check name uniqueness (that requires a subgraph round-trip).
 */
export function validateFields(raw: unknown): ValidatedInput {
  if (!raw || typeof raw !== 'object') {
    throw new ValidationError(400, 'Body must be a JSON object');
  }
  const r = raw as Record<string, unknown>;

  const agent = r.agent;
  if (typeof agent !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(agent)) {
    throw new ValidationError(400, 'agent must be a 0x-prefixed 40-hex-char address');
  }
  const addr = agent.toLowerCase() as `0x${string}`;

  const name = r.name;
  if (typeof name !== 'string') throw new ValidationError(400, 'name is required');
  const nameTrim = name.trim();
  if (nameTrim.length < NAME_MIN || nameTrim.length > NAME_MAX) {
    throw new ValidationError(400, `name must be ${NAME_MIN}-${NAME_MAX} characters`);
  }

  const description = r.description;
  if (typeof description !== 'string') throw new ValidationError(400, 'description is required');
  const descTrim = description.trim();
  if (descTrim.length < DESCRIPTION_MIN || descTrim.length > DESCRIPTION_MAX) {
    throw new ValidationError(400, `description must be ${DESCRIPTION_MIN}-${DESCRIPTION_MAX} characters`);
  }

  let image = `${RELAYER_BASE}/agent/${addr}/image`;
  if (r.image !== undefined && r.image !== null && r.image !== '') {
    if (typeof r.image !== 'string' || !isHttpUrl(r.image)) {
      throw new ValidationError(400, 'image must be an http(s) URL');
    }
    image = r.image;
  }

  let externalUrl = `${PLATFORM_URL}/agent/${addr}`;
  if (r.externalUrl !== undefined && r.externalUrl !== null && r.externalUrl !== '') {
    if (typeof r.externalUrl !== 'string' || !isHttpUrl(r.externalUrl)) {
      throw new ValidationError(400, 'externalUrl must be an http(s) URL');
    }
    externalUrl = r.externalUrl;
  }

  return { agent: addr, name: nameTrim, description: descTrim, image, externalUrl };
}

/**
 * Build the on-chain agentURI: an inline data:application/json;base64 blob
 * conforming to the ERC-8004 registration metadata shape.
 */
export function buildAgentURI(input: ValidatedInput): string {
  const meta = {
    type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
    name: input.name,
    description: input.description,
    image: input.image,
    external_url: input.externalUrl,
    active: true,
    registrations: [{ agentRegistry: `eip155:137:${IDENTITY_REGISTRY}` }],
  };
  return 'data:application/json;base64,' + Buffer.from(JSON.stringify(meta)).toString('base64');
}

/**
 * Decode our own data:application/json;base64,... URIs. Returns null if
 * not a recognized data-URI shape or if JSON parse fails.
 */
function decodeAgentMetaUri(uri: string): { name?: string } | null {
  const prefix = 'data:application/json;base64,';
  if (typeof uri !== 'string' || !uri.startsWith(prefix)) return null;
  try {
    const json = Buffer.from(uri.slice(prefix.length), 'base64').toString('utf8');
    const parsed = JSON.parse(json);
    return typeof parsed === 'object' && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Check whether `name` is already used by another already-registered
 * agent. Compares case-insensitively, trimmed.
 *
 * Only inspects data:application/json;base64 URIs — we can decode those
 * locally without a network round-trip. External http(s) URIs are
 * skipped (a tiny minority of historical registrations) since fetching
 * each on every register call is expensive and unreliable.
 */
export async function isNameTaken(name: string, excludeAgent?: string): Promise<boolean> {
  const target = name.trim().toLowerCase();
  const exclude = excludeAgent?.toLowerCase();

  const resp = await fetch(SUBGRAPH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: '{ agents(first: 1000, where: { registeredAt_gt: 0 }) { id agentURI } }',
    }),
  });
  if (!resp.ok) {
    // Fail open: if the subgraph is unreachable, don't block registration.
    // Better to occasionally allow a duplicate than to deny the whole flow.
    console.warn(`isNameTaken: subgraph HTTP ${resp.status}, skipping uniqueness check`);
    return false;
  }
  const json = await resp.json().catch(() => null);
  const agents: Array<{ id: string; agentURI?: string }> = json?.data?.agents ?? [];

  for (const a of agents) {
    if (exclude && a.id.toLowerCase() === exclude) continue;
    const meta = decodeAgentMetaUri(a.agentURI ?? '');
    const existing = typeof meta?.name === 'string' ? meta.name.trim().toLowerCase() : '';
    if (existing && existing === target) return true;
  }
  return false;
}
