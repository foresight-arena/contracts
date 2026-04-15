import { keccak256, toBytes } from 'viem';
import { S3Client, PutObjectCommand, GetObjectCommand, NoSuchKey } from '@aws-sdk/client-s3';

const SUBGRAPH = 'https://api.studio.thegraph.com/query/1745354/foresight-arena/version/latest';

const MAX_CONTENT_BYTES = 256 * 1024; // 256 KB cap

let s3: S3Client | null = null;
function getS3(): S3Client {
  if (!s3) s3 = new S3Client({});
  return s3;
}

function getBucket(): string {
  const bucket = process.env.REASONING_BUCKET;
  if (!bucket) throw new Error('REASONING_BUCKET env var not set');
  return bucket;
}

async function querySubgraph(query: string): Promise<any> {
  const resp = await fetch(SUBGRAPH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const json = await resp.json();
  return json.data;
}

/**
 * Canonical JSON serialization — sorted keys so the same logical content
 * always produces the same hash regardless of key insertion order.
 */
export function canonicalize(content: unknown): string {
  if (content === null || typeof content !== 'object') return JSON.stringify(content);
  if (Array.isArray(content)) return '[' + content.map(canonicalize).join(',') + ']';
  const obj = content as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize(obj[k])).join(',') + '}';
}

export function hashContent(content: unknown): `0x${string}` {
  const json = canonicalize(content);
  return keccak256(toBytes(json));
}

/**
 * Verify that the reasoning content matches the on-chain reasoningHash
 * stored for (roundId, agent) in the subgraph.
 */
export async function verifyReasoningHash(
  roundId: number,
  agent: string,
  content: unknown,
): Promise<boolean> {
  const data = await querySubgraph(`{
    commits(where: { roundId: "${roundId}", agent: "${agent.toLowerCase()}" }) {
      reasoningHash
    }
  }`);

  const commits = data?.commits || [];
  if (commits.length === 0) return false;

  const onChainHash = commits[0].reasoningHash as string;
  if (!onChainHash || onChainHash === '0x0000000000000000000000000000000000000000000000000000000000000000') {
    return false;
  }

  const computedHash = hashContent(content);
  return computedHash.toLowerCase() === onChainHash.toLowerCase();
}

/**
 * Check if a round's revealStart has passed (for reasoning submission timing gate).
 */
export async function hasRevealStartPassed(roundId: number): Promise<boolean> {
  const data = await querySubgraph(`{
    rounds(where: { roundId: "${roundId}" }) {
      revealStart
    }
  }`);

  const rounds = data?.rounds || [];
  if (rounds.length === 0) return false;

  const revealStart = Number(rounds[0].revealStart);
  const now = Math.floor(Date.now() / 1000);
  return now >= revealStart;
}

/**
 * Check if outcomes have been triggered for a round.
 */
export async function isOutcomesTriggeredSubgraph(roundId: number): Promise<boolean> {
  const data = await querySubgraph(`{
    rounds(where: { roundId: "${roundId}" }) {
      outcomesTriggered
    }
  }`);

  const rounds = data?.rounds || [];
  if (rounds.length === 0) return false;
  return rounds[0].outcomesTriggered === true;
}

function s3Key(roundId: number, agent: string): string {
  return `reasoning/${roundId}/${agent.toLowerCase()}.json`;
}

export async function uploadReasoning(
  roundId: number,
  agent: string,
  content: unknown,
): Promise<{ key: string; size: number }> {
  const json = canonicalize(content);
  const size = Buffer.byteLength(json, 'utf-8');

  if (size > MAX_CONTENT_BYTES) {
    throw new Error(`Content too large: ${size} bytes (max ${MAX_CONTENT_BYTES})`);
  }

  const key = s3Key(roundId, agent);
  await getS3().send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: key,
      Body: json,
      ContentType: 'application/json',
      CacheControl: 'public, max-age=300',
    }),
  );

  return { key, size };
}

export async function getReasoning(roundId: number, agent: string): Promise<unknown | null> {
  try {
    const resp = await getS3().send(
      new GetObjectCommand({
        Bucket: getBucket(),
        Key: s3Key(roundId, agent),
      }),
    );
    if (!resp.Body) return null;
    const text = await resp.Body.transformToString('utf-8');
    return JSON.parse(text);
  } catch (err) {
    if (err instanceof NoSuchKey) return null;
    throw err;
  }
}
