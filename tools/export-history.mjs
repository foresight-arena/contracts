#!/usr/bin/env node
/**
 * Export scored rounds for post-mortem analysis: markets (question, description,
 * benchmark price, outcome, scored flag), and each revealed agent's predictions,
 * scores and posted per-market reasoning.
 *
 * Sources: subgraph (rounds/predictions/scores/outcomes), relayer /reasoning
 * (reasoning strings) and relayer /polymarket proxy (market metadata).
 *
 * Usage:
 *   node export-history.mjs --from 2026-04-01 --to 2026-05-01 [--agents 0xa,0xb] [--out file.json]
 *   node export-history.mjs --from-round 1 --to-round 50
 *   node export-history.mjs --from-round 169 --include-pending   (also revealed rounds without outcomes yet)
 *
 * Env: SUBGRAPH_URL (default: public Studio endpoint), RELAYER_URL (default: production).
 */

import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { parseArgs } from './lib/common.mjs';

const SUBGRAPH_URL = process.env.SUBGRAPH_URL
  || 'https://api.studio.thegraph.com/query/1745354/foresight-arena/version/latest';
const RELAYER_URL = process.env.RELAYER_URL || 'https://api.foresightarena.xyz';
const ZERO_HASH = '0x' + '0'.repeat(64);

const toUnix = (date) => Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000);

async function gql(query, variables) {
  const resp = await fetch(SUBGRAPH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const data = await resp.json();
  if (data.errors) throw new Error(`Subgraph: ${JSON.stringify(data.errors).slice(0, 300)}`);
  return data.data;
}

async function getJson(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await fetch(url);
      if (resp.status === 404) return null;
      if (resp.ok) return await resp.json();
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
  }
  return null;
}

/** Run `fn` over `items` with bounded concurrency (be gentle with the relayer). */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}

function agentName(uri) {
  if (!uri) return null;
  if (uri.startsWith('data:application/json;base64,')) {
    try { return JSON.parse(Buffer.from(uri.slice(29), 'base64').toString()).name || null; } catch { return null; }
  }
  return uri;
}

async function getMarketMeta(conditionId) {
  for (const closed of ['true', 'false']) {
    const list = await getJson(`${RELAYER_URL}/polymarket/markets?condition_ids=${conditionId}&closed=${closed}`);
    if (Array.isArray(list) && list.length) {
      const m = list[0];
      return {
        question: m.question || null,
        description: m.description || null,
        endDate: m.endDateIso || m.endDate || null,
        eventTitle: m.events?.[0]?.title || null,
        tags: (m.events?.[0]?.tags || []).map((t) => t.label || t.slug).filter(Boolean),
      };
    }
  }
  return null;
}

const ROUNDS_QUERY = `
  query($where: Round_filter!, $skip: Int!) {
    rounds(first: 100, skip: $skip, orderBy: roundId, where: $where) {
      roundId commitDeadline revealStart revealDeadline invalidated outcomesTriggered outcomesTriggeredAt resolvedBitmask
      roundMarkets(orderBy: marketIndex) {
        marketIndex benchmarkPrice
        market { conditionId outcome resolvedAtTimestamp }
      }
      agentRounds(first: 1000, where: { revealed: true }) {
        agent { id agentURI }
        predictions brierScore alphaScore scoredMarkets totalMarkets reasoningHash commitTimestamp
      }
    }
  }`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const where = { invalidated: false };
  // Default: scored rounds only. --include-pending also exports revealed rounds
  // whose outcomes aren't triggered yet (outcome/Brier/alpha are null there).
  if (!('include-pending' in args)) where.outcomesTriggered = true;
  if (args.from) where.commitDeadline_gte = toUnix(args.from);
  if (args.to) where.commitDeadline_lt = toUnix(args.to);
  if (args['from-round']) where.roundId_gte = args['from-round'];
  if (args['to-round']) where.roundId_lte = args['to-round'];
  const agentFilter = args.agents ? new Set(args.agents.toLowerCase().split(',')) : null;

  const rounds = [];
  for (let skip = 0; ; skip += 100) {
    const page = (await gql(ROUNDS_QUERY, { where, skip })).rounds;
    rounds.push(...page);
    if (page.length < 100) break;
  }
  console.error(`${rounds.length} round(s)${where.outcomesTriggered ? ' with outcomes' : ''}`);

  const conditionIds = [...new Set(rounds.flatMap((r) => r.roundMarkets.map((m) => m.market.conditionId)))];
  console.error(`Fetching metadata for ${conditionIds.length} market(s)...`);
  const metas = await mapLimit(conditionIds, 4, getMarketMeta);
  const metaById = Object.fromEntries(conditionIds.map((cid, i) => [cid, metas[i]]));

  const out = [];
  for (const r of rounds) {
    const bitmask = BigInt(r.resolvedBitmask || 0);
    const markets = r.roundMarkets.map((rm) => {
      const outcome = rm.market.outcome === 'YES' ? 1 : rm.market.outcome === 'NO' ? 0 : null;
      return {
        index: rm.marketIndex,
        conditionId: rm.market.conditionId,
        ...metaById[rm.market.conditionId],
        benchmarkBps: rm.benchmarkPrice,
        outcome: rm.market.outcome,
        // When the condition resolved on the CTF (null if not yet)
        resolvedAt: rm.market.resolvedAtTimestamp ? new Date(Number(rm.market.resolvedAtTimestamp) * 1000).toISOString() : null,
        // Only markets resolved at trigger time count toward on-chain scores
        scored: ((bitmask >> BigInt(rm.marketIndex)) & 1n) === 1n,
        benchmarkBrier: outcome == null || rm.benchmarkPrice == null ? null : (rm.benchmarkPrice / 1e4 - outcome) ** 2,
      };
    });

    const agents = r.agentRounds.filter((ar) => !agentFilter || agentFilter.has(ar.agent.id));
    const agentRows = await mapLimit(agents, 4, async (ar) => {
      const reasoning = ar.reasoningHash && ar.reasoningHash !== ZERO_HASH
        ? await getJson(`${RELAYER_URL}/reasoning/${r.roundId}/${ar.agent.id}`)
        : null;
      return {
        address: ar.agent.id,
        name: agentName(ar.agent.agentURI),
        committedAt: new Date(Number(ar.commitTimestamp) * 1000).toISOString(),
        brierScore: Number(ar.brierScore),
        alphaScore: Number(ar.alphaScore),
        scoredMarkets: ar.scoredMarkets,
        perMarket: ar.predictions.map((p, i) => {
          const o = markets[i]?.outcome === 'YES' ? 1 : markets[i]?.outcome === 'NO' ? 0 : null;
          const brier = o == null ? null : (p / 1e4 - o) ** 2;
          return {
            index: i,
            predictionBps: p,
            brier,
            // Positive = beat the market on this market
            alpha: brier == null || markets[i].benchmarkBrier == null ? null : markets[i].benchmarkBrier - brier,
            reasoning: Array.isArray(reasoning) ? reasoning[i] ?? null : null,
          };
        }),
      };
    });

    out.push({
      roundId: Number(r.roundId),
      commitDeadline: new Date(Number(r.commitDeadline) * 1000).toISOString(),
      revealStart: new Date(Number(r.revealStart) * 1000).toISOString(),
      outcomesTriggeredAt: r.outcomesTriggeredAt ? new Date(Number(r.outcomesTriggeredAt) * 1000).toISOString() : null,
      markets,
      agents: agentRows,
    });
    console.error(`round ${r.roundId}: ${markets.length} markets, ${agentRows.length} agents, ${agentRows.filter((a) => a.perMarket.some((m) => m.reasoning)).length} with reasoning`);
  }

  const label = args.from || args['from-round'] || 'all';
  const labelTo = args.to || args['to-round'] || 'latest';
  const path = args.out || join(dirname(fileURLToPath(import.meta.url)), 'out', `history-${label}-${labelTo}.json`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ exportedAt: new Date().toISOString(), rounds: out }, null, 2));
  console.error(`Wrote ${path}`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
