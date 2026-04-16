#!/bin/bash
set -euo pipefail

# ─── Config ──────────────────────────────────────────────────────────────
# Required env vars:
#   RPC_URL          — Polygon RPC endpoint
#   CURATOR_KEY      — Curator private key (creates round, posts benchmarks, triggers)
#   AGENT_KEY        — Agent private key (commits, reveals)

RPC_URL="${RPC_URL:?Set RPC_URL}"
CURATOR_KEY="${CURATOR_KEY:?Set CURATOR_KEY}"
AGENT_KEY="${AGENT_KEY:?Set AGENT_KEY}"

ROUND_MANAGER="0x31861F5E8540257AFd98C4F4693Aa67ac7462909"
ARENA="0x95899D57cF8A74dC3892B93F221763a4547e394c"

AGENT_ADDRESS=$(cast wallet address "$AGENT_KEY")
echo "Agent: $AGENT_ADDRESS"
echo ""

# ─── Market selection ────────────────────────────────────────────────────
# Pass CONDITION_ID as env var, or default to a test market
CID="${CONDITION_ID:?Set CONDITION_ID (bytes32 conditionId from Polymarket)}"

# ─── Prediction ──────────────────────────────────────────────────────────
PREDICTION="${PREDICTION:-5500}"  # basis points, default 55%
BENCHMARK="${BENCHMARK:-5000}"    # default 50%

echo "=== Test Round ==="
echo "Condition ID: $CID"
echo "Prediction:   ${PREDICTION} bps ($(echo "scale=1; $PREDICTION / 100" | bc)%)"
echo "Benchmark:    ${BENCHMARK} bps"
echo ""

# ─── Step 1: Create round ────────────────────────────────────────────────
NOW=$(date +%s)
COMMIT_DL=$((NOW + 600))       # 10 min
REVEAL_START=$((NOW + 660))    # 11 min
REVEAL_DL=$((NOW + 86400))     # 24 hours

echo "=== Step 1: Create Round ==="
echo "  Commit deadline:  $(date -r $COMMIT_DL '+%H:%M:%S') (in 10 min)"
echo "  Reveal start:     $(date -r $REVEAL_START '+%H:%M:%S') (in 11 min)"
echo "  Reveal deadline:  $(date -r $REVEAL_DL '+%H:%M:%S') (in 24h)"

TX=$(cast send "$ROUND_MANAGER" \
  "createRound(bytes32[],uint64,uint64,uint64,uint16)" \
  "[$CID]" "$COMMIT_DL" "$REVEAL_START" "$REVEAL_DL" 0 \
  --rpc-url "$RPC_URL" --private-key "$CURATOR_KEY" --json | jq -r .transactionHash)
echo "  TX: $TX"

# Read the round ID
ROUND_ID=$(cast call "$ROUND_MANAGER" "currentRoundId()(uint256)" --rpc-url "$RPC_URL")
echo "  Round ID: $ROUND_ID"
echo ""

# ─── Step 2: Commit ──────────────────────────────────────────────────────
echo "=== Step 2: Commit ==="

# Generate salt
SALT=$(cast keccak "0x$(printf '%064x' $((RANDOM * RANDOM + $(date +%s))))")

# Compute commit hash: keccak256(abi.encodePacked(uint256 roundId, uint16 prediction, bytes32 salt))
R=$(printf '%064x' "$ROUND_ID")
P=$(printf '%04x' "$PREDICTION")
S=${SALT:2}
COMMIT_HASH=$(cast keccak "0x${R}${P}${S}")

echo "  Salt: $SALT"
echo "  Commit hash: $COMMIT_HASH"

ZERO_HASH="0x0000000000000000000000000000000000000000000000000000000000000000"

TX=$(cast send "$ARENA" \
  "commit(uint256,bytes32,bytes32)" "$ROUND_ID" "$COMMIT_HASH" "$ZERO_HASH" \
  --rpc-url "$RPC_URL" --private-key "$AGENT_KEY" --json | jq -r .transactionHash)
echo "  TX: $TX"
echo ""

# ─── Step 3: Wait for reveal ─────────────────────────────────────────────
WAIT=$((REVEAL_START - $(date +%s)))
if [ "$WAIT" -gt 0 ]; then
  echo "=== Step 3: Waiting ${WAIT}s for reveal window ==="
  sleep "$WAIT"
fi
echo ""

# ─── Step 4: Reveal ──────────────────────────────────────────────────────
echo "=== Step 4: Reveal ==="
TX=$(cast send "$ARENA" \
  "reveal(uint256,uint16[],bytes32)" "$ROUND_ID" "[$PREDICTION]" "$SALT" \
  --rpc-url "$RPC_URL" --private-key "$AGENT_KEY" --json | jq -r .transactionHash)
echo "  TX: $TX"
echo ""

# ─── Step 5: Post benchmarks ─────────────────────────────────────────────
echo "=== Step 5: Post Benchmarks ==="
TX=$(cast send "$ROUND_MANAGER" \
  "postBenchmarkPrices(uint256,uint16[])" "$ROUND_ID" "[$BENCHMARK]" \
  --rpc-url "$RPC_URL" --private-key "$CURATOR_KEY" --json | jq -r .transactionHash)
echo "  TX: $TX"
echo ""

# ─── Step 6: Trigger outcomes + score ─────────────────────────────────────
echo "=== Step 6: Trigger Outcomes & Score ==="
echo "  Note: market must be resolved on the CTF oracle for scoring to work."
echo "  If this fails with 'Benchmarks not posted', wait and retry."

TX=$(cast send "$ARENA" \
  "triggerOutcomesAndScore(uint256)" "$ROUND_ID" \
  --rpc-url "$RPC_URL" --private-key "$CURATOR_KEY" --json | jq -r .transactionHash) || {
  echo "  triggerOutcomesAndScore failed (market may not be resolved yet)"
  echo "  Retry later with:"
  echo "    cast send $ARENA \"triggerOutcomesAndScore(uint256)\" $ROUND_ID --rpc-url \$RPC_URL --private-key \$CURATOR_KEY"
  echo ""
  echo "=== Partial test complete (commit + reveal OK, scoring deferred) ==="
  exit 0
}
echo "  TX: $TX"
echo ""

# ─── Step 7: Check score ─────────────────────────────────────────────────
echo "=== Step 7: Check Score ==="
SCORE=$(cast call "$ARENA" \
  "getScore(uint256,address)(uint256,int256,uint16,uint16)" "$ROUND_ID" "$AGENT_ADDRESS" \
  --rpc-url "$RPC_URL")
echo "  Score: $SCORE"
echo ""
echo "=== Test complete ==="
