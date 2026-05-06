#!/usr/bin/env node
/*
 * Check POL balances on Polygon mainnet and send a Telegram alert when
 * any monitored address is below the threshold.
 *
 * No dependencies — needs Node 18+ for built-in fetch.
 *
 * Required env:
 *   TELEGRAM_BOT_TOKEN   — bot API token from @BotFather
 *   TELEGRAM_CHAT_ID     — destination chat id (or @channelusername)
 *   POL_ADDRESSES        — comma-separated entries. Each entry is either
 *                          "label:0x..."  (label shown in the alert)
 *                          "0x..."        (address used as the label)
 *
 * Optional env:
 *   POL_THRESHOLD        — low-water mark in POL (default 0.5)
 *   POL_RPC_URL          — Polygon JSON-RPC endpoint (default polygon.drpc.org)
 *   DRY_RUN              — if "1", print the alert to stdout instead of
 *                          sending it to Telegram (handy for first run)
 *
 * Exit codes:
 *   0 — all addresses checked; alert sent only if needed
 *   1 — config error, every RPC failed, or Telegram delivery failed
 *
 * Example crontab (every 15 min):
 *   [slash]15 * * * * TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=... \
 *     POL_ADDRESSES=relayer:0xabc...,curator:0xdef... \
 *     POL_THRESHOLD=0.5 \
 *     /usr/bin/env node /path/to/check-pol-balances.mjs
 *   (replace [slash] with the literal asterisk-slash)
 */

const RPC = process.env.POL_RPC_URL || 'https://polygon.drpc.org';
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT = process.env.TELEGRAM_CHAT_ID;
const THRESHOLD_POL = process.env.POL_THRESHOLD ? Number(process.env.POL_THRESHOLD) : 0.5;
const ADDRESSES_RAW = process.env.POL_ADDRESSES;
const DRY = process.env.DRY_RUN === '1';

function die(msg) {
  console.error(`check-pol-balances: ${msg}`);
  process.exit(1);
}

if (!TG_TOKEN && !DRY) die('TELEGRAM_BOT_TOKEN is required (or set DRY_RUN=1)');
if (!TG_CHAT && !DRY) die('TELEGRAM_CHAT_ID is required (or set DRY_RUN=1)');
if (!ADDRESSES_RAW) die('POL_ADDRESSES is required, e.g. "relayer:0xabc...,curator:0xdef..."');
if (!Number.isFinite(THRESHOLD_POL) || THRESHOLD_POL < 0) die(`bad POL_THRESHOLD: ${process.env.POL_THRESHOLD}`);

const targets = ADDRESSES_RAW
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map((entry) => {
    const idx = entry.indexOf(':');
    let label, address;
    if (idx === -1) {
      label = entry;
      address = entry;
    } else {
      label = entry.slice(0, idx).trim();
      address = entry.slice(idx + 1).trim();
    }
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) die(`bad address: ${address}`);
    return { label, address };
  });

if (targets.length === 0) die('no addresses parsed from POL_ADDRESSES');

// Convert decimal POL → wei BigInt without floating-point drift.
function polToWei(amount) {
  const [whole, fracRaw = ''] = String(amount).split('.');
  const frac = (fracRaw + '0'.repeat(18)).slice(0, 18);
  return BigInt(whole) * 10n ** 18n + BigInt(frac || '0');
}

function formatPol(wei) {
  const negative = wei < 0n;
  const abs = negative ? -wei : wei;
  const whole = abs / 10n ** 18n;
  const frac = (abs % 10n ** 18n).toString().padStart(18, '0').slice(0, 4);
  return `${negative ? '-' : ''}${whole}.${frac}`;
}

async function getBalance(address) {
  const r = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_getBalance',
      params: [address, 'latest'],
    }),
  });
  if (!r.ok) throw new Error(`RPC HTTP ${r.status}`);
  const j = await r.json();
  if (j.error) throw new Error(`RPC error: ${j.error.message ?? JSON.stringify(j.error)}`);
  return BigInt(j.result);
}

async function sendTelegram(text) {
  const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TG_CHAT,
      text,
      disable_web_page_preview: true,
    }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`Telegram HTTP ${r.status}: ${body.slice(0, 200)}`);
  }
}

const thresholdWei = polToWei(THRESHOLD_POL);

const results = await Promise.all(targets.map(async ({ label, address }) => {
  try {
    const balance = await getBalance(address);
    return { label, address, balance, low: balance < thresholdWei };
  } catch (e) {
    return { label, address, error: e.message ?? String(e) };
  }
}));

const lows = results.filter((r) => r.low);
const errors = results.filter((r) => r.error);

// Quiet on success — cron-friendly.
if (lows.length === 0 && errors.length === 0) process.exit(0);

const lines = [`POL balance alert — threshold ${THRESHOLD_POL} POL`];
for (const r of lows) {
  const short = `${r.address.slice(0, 6)}...${r.address.slice(-4)}`;
  lines.push(`• ${r.label} (${short}): ${formatPol(r.balance)} POL`);
}
for (const r of errors) {
  lines.push(`• ${r.label}: lookup failed — ${r.error}`);
}
const text = lines.join('\n');

if (DRY) {
  console.log(text);
  process.exit(0);
}

try {
  await sendTelegram(text);
} catch (e) {
  console.error('check-pol-balances: failed to deliver alert:', e.message ?? e);
  console.error('--- intended message ---');
  console.error(text);
  process.exit(1);
}
