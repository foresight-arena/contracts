import { BigInt } from "@graphprotocol/graph-ts"
import {
  RoundCreated,
  BenchmarksPosted,
  RoundInvalidated,
} from "../generated/FastRoundManager/RoundManager"
import { Round, Market, RoundMarket } from "../generated/schema"

export function handleRoundCreated(event: RoundCreated): void {
  let roundId = event.params.roundId
  let round = new Round(roundId.toString())
  round.roundId = roundId
  round.conditionIds = event.params.conditionIds
  round.benchmarkPrices = []
  round.commitDeadline = event.params.commitDeadline
  round.revealStart = event.params.commitDeadline
  round.revealDeadline = event.params.revealDeadline
  round.benchmarksPosted = false
  round.invalidated = false
  round.createdAtBlock = event.block.number
  round.createdAtTimestamp = event.block.timestamp
  round.marketCount = event.params.conditionIds.length
  round.save()

  let conditionIds = event.params.conditionIds
  for (let i = 0; i < conditionIds.length; i++) {
    let cid = conditionIds[i]
    let marketId = cid.toHexString()

    let market = Market.load(marketId)
    if (market == null) {
      market = new Market(marketId)
      market.conditionId = cid
      market.outcome = null
      market.resolvedAtTimestamp = null
      market.save()
    }

    let rmId = roundId.toString() + "-" + i.toString()
    let roundMarket = new RoundMarket(rmId)
    roundMarket.round = round.id
    roundMarket.market = marketId
    roundMarket.marketIndex = i
    roundMarket.benchmarkPrice = 0
    roundMarket.save()
  }
}

export function handleBenchmarksPosted(event: BenchmarksPosted): void {
  let roundId = event.params.roundId
  let round = Round.load(roundId.toString())
  if (round == null) return

  round.benchmarkPrices = event.params.benchmarkPrices
  round.benchmarksPosted = true
  round.save()

  let prices = event.params.benchmarkPrices
  for (let i = 0; i < prices.length; i++) {
    let rmId = roundId.toString() + "-" + i.toString()
    let rm = RoundMarket.load(rmId)
    if (rm != null) {
      rm.benchmarkPrice = prices[i]
      rm.save()
    }
  }
}

export function handleRoundInvalidated(event: RoundInvalidated): void {
  let round = Round.load(event.params.roundId.toString())
  if (round == null) return
  round.invalidated = true
  round.save()
}
