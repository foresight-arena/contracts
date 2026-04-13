import { verifyTypedData, keccak256, toBytes } from 'viem';
import { S3Client, PutObjectCommand, GetObjectCommand, NoSuchKey } from '@aws-sdk/client-s3';
import { config } from '../config.js';
import type { ReasoningRequest } from './types.js';

const reasoningTypes = {
  ReasoningPost: [
    { name: 'roundId', type: 'uint256' },
    { name: 'agent', type: 'address' },
    { name: 'contentHash', type: 'bytes32' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

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

function getWhitelist(): Set<string> {
  const raw = process.env.REASONING_WHITELIST || '';
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isWhitelisted(agent: string): boolean {
  return getWhitelist().has(agent.toLowerCase());
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

export async function verifyReasoningSignature(req: ReasoningRequest): Promise<boolean> {
  const contentHash = hashContent(req.content);

  return verifyTypedData({
    address: req.agent,
    domain: config.eip712Domain,
    types: reasoningTypes,
    primaryType: 'ReasoningPost',
    message: {
      roundId: BigInt(req.roundId),
      agent: req.agent,
      contentHash,
      deadline: BigInt(req.deadline),
    },
    signature: req.signature,
  });
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
