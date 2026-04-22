import { DynamoDBClient, GetItemCommand, PutItemCommand, ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { encodePacked, keccak256 } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { config } from '../config.js';
import { isAgentRegistered } from './submit.js';

const CHALLENGE_TTL_SECONDS = 15 * 60;   // 15 minutes
const VOUCHER_TTL_SECONDS = 60 * 60;     // 1 hour
const USED_TWEET_TTL_DAYS = 30;

let ddb: DynamoDBClient | null = null;
function getDdb(): DynamoDBClient {
  if (!ddb) ddb = new DynamoDBClient({});
  return ddb;
}

function tableName(): string {
  return config.voucherTableName;
}

// ─── Challenge ───────────────────────────────────────────────────────────────

function buildSuggestedTweet(code: string): string {
  return `I'm joining @ForesightArena — an on-chain prediction competition for AI agents. Let's see who can beat the market.\n\nhttps://foresightarena.xyz\n\n${code}`;
}

export async function createChallenge(agent: string): Promise<{ code: string; expiresAt: number; instructions: string; suggestedTweet: string }> {
  const addr = agent.toLowerCase() as `0x${string}`;

  // Reject if already registered
  if (await isAgentRegistered(addr)) {
    throw new VoucherError(409, 'Agent already registered');
  }

  // Return existing non-expired challenge (idempotent)
  const existing = await getChallenge(addr);
  if (existing) {
    return {
      code: existing.code,
      expiresAt: existing.expiresAt,
      instructions: `Post a tweet containing the code ${existing.code}. You can use the suggested tweet below or write your own — just include the code.`,
      suggestedTweet: buildSuggestedTweet(existing.code),
    };
  }

  // Generate new challenge
  const now = Math.floor(Date.now() / 1000);
  const random = Math.floor(Math.random() * 1e18).toString(16);
  const hash = keccak256(encodePacked(
    ['address', 'uint256', 'uint256'],
    [addr, BigInt(now), BigInt(`0x${random}`)],
  ));
  const code = 'fsa-' + hash.slice(2, 14);
  const expiresAt = now + CHALLENGE_TTL_SECONDS;

  await getDdb().send(new PutItemCommand({
    TableName: tableName(),
    Item: {
      pk: { S: `CHALLENGE#${addr}` },
      code: { S: code },
      createdAt: { N: String(now) },
      expiresAt: { N: String(expiresAt) },
      ttl: { N: String(expiresAt + 3600) }, // DynamoDB TTL: clean up ~1h after expiry
    },
  }));

  return {
    code,
    expiresAt,
    instructions: `Post a tweet containing the code ${code}. You can use the suggested tweet below or write your own — just include the code.`,
    suggestedTweet: buildSuggestedTweet(code),
  };
}

async function getChallenge(agent: string): Promise<{ code: string; expiresAt: number } | null> {
  const resp = await getDdb().send(new GetItemCommand({
    TableName: tableName(),
    Key: { pk: { S: `CHALLENGE#${agent.toLowerCase()}` } },
  }));
  if (!resp.Item) return null;
  const expiresAt = Number(resp.Item.expiresAt?.N || 0);
  if (Math.floor(Date.now() / 1000) >= expiresAt) return null; // expired
  return { code: resp.Item.code?.S || '', expiresAt };
}

// ─── Tweet verification + voucher signing ────────────────────────────────────

const TWEET_URL_RE = /^https:\/\/(twitter\.com|x\.com)\/(\w+)\/status\/(\d+)/;

interface OEmbedResult {
  html: string;
  authorName: string;
  authorUrl: string;
}

export async function verifyTweetAndSign(agent: string, tweetUrl: string): Promise<{ signature: string; expiry: number }> {
  const addr = agent.toLowerCase() as `0x${string}`;

  // Parse tweet URL
  const match = tweetUrl.match(TWEET_URL_RE);
  if (!match) throw new VoucherError(400, 'Invalid tweet URL format');
  const username = match[2];
  const tweetId = match[3];

  // Load challenge
  const challenge = await getChallenge(addr);
  if (!challenge) throw new VoucherError(404, 'No pending challenge for this agent (request one first or it expired)');

  // Fetch tweet content via oEmbed
  const oembed = await fetchTweetOEmbed(tweetUrl);
  if (!oembed.html.includes(challenge.code)) {
    throw new VoucherError(403, `Tweet does not contain the challenge code: ${challenge.code}`);
  }

  // Extract plain text from oEmbed HTML (strip tags)
  const tweetText = oembed.html.replace(/<[^>]+>/g, '').trim();

  // Mark tweet as used (atomic — fails if already used). Store metadata.
  const now = Math.floor(Date.now() / 1000);
  try {
    await getDdb().send(new PutItemCommand({
      TableName: tableName(),
      Item: {
        pk: { S: `TWEET#${tweetId}` },
        agent: { S: addr },
        username: { S: oembed.authorName || username },
        tweetUrl: { S: tweetUrl },
        tweetText: { S: tweetText },
        usedAt: { N: String(now) },
        ttl: { N: String(now + USED_TWEET_TTL_DAYS * 86400) },
      },
      ConditionExpression: 'attribute_not_exists(pk)',
    }));
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      throw new VoucherError(409, 'This tweet has already been used for verification');
    }
    throw err;
  }

  // Sign voucher
  const voucher = await signVoucher(addr);
  return voucher;
}

async function fetchTweetOEmbed(tweetUrl: string): Promise<OEmbedResult> {
  const oembedUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(tweetUrl)}&omit_script=true`;
  const resp = await fetch(oembedUrl, { signal: AbortSignal.timeout(10_000) });
  if (!resp.ok) {
    throw new VoucherError(400, `Could not fetch tweet (status ${resp.status}). Is the tweet public?`);
  }
  const data: any = await resp.json();
  return {
    html: typeof data.html === 'string' ? data.html : '',
    authorName: typeof data.author_name === 'string' ? data.author_name : '',
    authorUrl: typeof data.author_url === 'string' ? data.author_url : '',
  };
}

async function signVoucher(agent: `0x${string}`): Promise<{ signature: string; expiry: number }> {
  if (!config.curatorPrivateKey) {
    throw new VoucherError(500, 'Curator private key not configured');
  }
  const expiry = Math.floor(Date.now() / 1000) + VOUCHER_TTL_SECONDS;
  const voucherHash = keccak256(encodePacked(['address', 'uint256'], [agent, BigInt(expiry)]));
  const account = privateKeyToAccount(config.curatorPrivateKey);
  // Raw sign (no EIP-191 prefix) — matches handler's recoverAddress({ hash, signature })
  const signature = await account.sign({ hash: voucherHash });
  return { signature, expiry };
}

// ─── Error helper ────────────────────────────────────────────────────────────

export class VoucherError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
