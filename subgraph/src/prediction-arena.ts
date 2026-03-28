import { Address, BigInt } from "@graphprotocol/graph-ts"
import {
  Committed,
  Revealed,
  ScoreComputed,
} from "../generated/PredictionArena/PredictionArena"
import { AgentRound, Agent, Round } from "../generated/schema"

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
}
