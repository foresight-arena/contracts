import { BigInt } from "@graphprotocol/graph-ts"
import { ConditionResolution } from "../generated/ConditionalTokens/ConditionalTokens"
import { Market } from "../generated/schema"

export function handleConditionResolution(event: ConditionResolution): void {
  let conditionId = event.params.conditionId.toHexString()
  let market = Market.load(conditionId)
  if (market == null) return // not one of our markets, skip

  // Mirror PredictionArena._triggerOutcomes scoring rules:
  //   payout0 == denom            -> YES
  //   payout0 == 0   (denom > 0)  -> NO
  //   0 < payout0 < denom         -> VOID (50/50 / split, excluded from bitmask)
  // Without this split-detection the UI showed VOID markets as YES because
  // the original check was just `payout0 > 0`.
  let payoutNumerators = event.params.payoutNumerators
  let denom = BigInt.zero()
  for (let i = 0; i < payoutNumerators.length; i++) {
    denom = denom.plus(payoutNumerators[i])
  }
  let payout0 = payoutNumerators.length > 0 ? payoutNumerators[0] : BigInt.zero()

  if (denom.equals(BigInt.zero())) {
    market.outcome = "VOID"
  } else if (payout0.equals(denom)) {
    market.outcome = "YES"
  } else if (payout0.equals(BigInt.zero())) {
    market.outcome = "NO"
  } else {
    market.outcome = "VOID"
  }

  market.resolvedAtTimestamp = event.block.timestamp
  market.save()
}
