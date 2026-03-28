import { BigInt } from "@graphprotocol/graph-ts"
import { ConditionResolution } from "../generated/ConditionalTokens/ConditionalTokens"
import { Market } from "../generated/schema"

export function handleConditionResolution(event: ConditionResolution): void {
  let conditionId = event.params.conditionId.toHexString()
  let market = Market.load(conditionId)
  if (market == null) return // not one of our markets, skip

  let payoutNumerators = event.params.payoutNumerators
  if (payoutNumerators.length >= 1 && payoutNumerators[0].gt(BigInt.zero())) {
    market.outcome = "YES"
  } else {
    market.outcome = "NO"
  }
  market.resolvedAtTimestamp = event.block.timestamp
  market.save()
}
