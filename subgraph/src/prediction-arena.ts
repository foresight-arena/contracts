import { Address, BigInt } from "@graphprotocol/graph-ts"
import {
  Committed,
  Revealed,
  ScoreComputed,
} from "../generated/PredictionArena/PredictionArena"
import { ConditionalTokens } from "../generated/PredictionArena/ConditionalTokens"
import { AgentRound, Agent, Round, Market } from "../generated/schema"

const CTF_ADDRESS = Address.fromString("0x4D97DCd97eC945f40cF65F87097ACe5EA0476045")

function getOrCreateAgent(address: string, rawAddress: Address): Agent {
  let agent = Agent.load(address)
  if (agent == null) {
    agent = new Agent(address)
    agent.address = rawAddress
    agent.name = ""
    agent.url = ""
    agent.owner = rawAddress
    agent.registeredAt = BigInt.zero()
    agent.totalBrierScore = BigInt.zero()
    agent.totalAlphaScore = BigInt.zero()
    agent.scoredRoundCount = 0
    agent.gaslessNonce = 0
    agent.lastActiveTimestamp = BigInt.zero()
  }
  return agent
}

export function handleCommitted(event: Committed): void {
  let roundId = event.params.roundId
  let agentAddr = event.params.agent.toHexString()
  let id = roundId.toString() + "-" + agentAddr

  let ar = new AgentRound(id)
  ar.round = roundId.toString()
  ar.agent = agentAddr
  ar.commitHash = event.params.commitHash
  ar.commitTimestamp = event.block.timestamp
  ar.revealed = false
  ar.predictions = []
  ar.brierScore = BigInt.zero()
  ar.alphaScore = BigInt.zero()
  ar.scoredMarkets = 0
  ar.totalMarkets = 0

  let round = Round.load(roundId.toString())
  if (round != null) {
    ar.totalMarkets = round.marketCount
  }

  ar.save()

  let agent = getOrCreateAgent(agentAddr, event.params.agent)
  agent.lastActiveTimestamp = event.block.timestamp
  // Track gasless nonce: if nonce != max uint256, it was a gasless call
  let maxUint = BigInt.fromI32(1).leftShift(255)  // approximate; exact check below
  let nonce = event.params.nonce
  if (nonce.lt(maxUint)) {
    // Gasless call — nonce is the actual nonce used. Next nonce = nonce + 1
    let nextNonce = nonce.toI32() + 1
    if (nextNonce > agent.gaslessNonce) {
      agent.gaslessNonce = nextNonce
    }
  }
  agent.save()
}

export function handleRevealed(event: Revealed): void {
  let roundId = event.params.roundId
  let agentAddr = event.params.agent.toHexString()
  let id = roundId.toString() + "-" + agentAddr

  let ar = AgentRound.load(id)
  if (ar == null) return

  ar.revealed = true
  ar.predictions = event.params.predictions
  ar.scoredMarkets = event.params.scoredMarkets
  ar.save()

  // Track gasless nonce on reveal too
  let maxUint = BigInt.fromI32(1).leftShift(255)
  let nonce = event.params.nonce
  if (nonce.lt(maxUint)) {
    let agent = Agent.load(agentAddr)
    if (agent != null) {
      let nextNonce = nonce.toI32() + 1
      if (nextNonce > agent.gaslessNonce) {
        agent.gaslessNonce = nextNonce
      }
      agent.save()
    }
  }
}

export function handleScoreComputed(event: ScoreComputed): void {
  let roundId = event.params.roundId
  let agentAddr = event.params.agent.toHexString()
  let id = roundId.toString() + "-" + agentAddr

  let ar = AgentRound.load(id)
  if (ar == null) return

  ar.brierScore = event.params.brierScore
  ar.alphaScore = event.params.alphaScore
  ar.scoredMarkets = event.params.scoredMarkets
  ar.save()

  // Update agent aggregate leaderboard
  if (event.params.scoredMarkets > 0) {
    let agent = Agent.load(agentAddr)
    if (agent != null) {
      agent.totalBrierScore = agent.totalBrierScore.plus(event.params.brierScore)
      agent.totalAlphaScore = agent.totalAlphaScore.plus(event.params.alphaScore)
      agent.scoredRoundCount = agent.scoredRoundCount + 1
      agent.lastActiveTimestamp = event.block.timestamp
      agent.save()
    }
  }

  // Resolve market outcomes via CTF contract call (handles pre-resolved markets)
  let round = Round.load(roundId.toString())
  if (round != null) {
    let ctf = ConditionalTokens.bind(CTF_ADDRESS)
    let conditionIds = round.conditionIds
    for (let i = 0; i < conditionIds.length; i++) {
      let marketId = conditionIds[i].toHexString()
      let market = Market.load(marketId)
      if (market != null && market.outcome == null) {
        let denomResult = ctf.try_payoutDenominator(conditionIds[i])
        if (!denomResult.reverted && denomResult.value.gt(BigInt.zero())) {
          let payout0Result = ctf.try_payoutNumerators(conditionIds[i], BigInt.zero())
          if (!payout0Result.reverted) {
            market.outcome = payout0Result.value.gt(BigInt.zero()) ? "YES" : "NO"
            market.resolvedAtTimestamp = event.block.timestamp
            market.save()
          }
        }
      }
    }
  }
}
