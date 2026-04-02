import { BigInt } from "@graphprotocol/graph-ts"
import {
  AgentRegistered,
  AgentUpdated,
} from "../generated/AgentRegistry/AgentRegistry"
import { Agent } from "../generated/schema"

export function handleAgentRegistered(event: AgentRegistered): void {
  let addr = event.params.agent.toHexString()

  let agent = Agent.load(addr)
  if (agent == null) {
    agent = new Agent(addr)
    agent.address = event.params.agent
    agent.totalBrierScore = BigInt.zero()
    agent.totalAlphaScore = BigInt.zero()
    agent.scoredRoundCount = 0
    agent.gaslessNonce = 0
    agent.lastActiveTimestamp = BigInt.zero()
  }

  agent.name = event.params.name
  agent.url = event.params.url
  agent.owner = event.params.owner
  agent.registeredAt = event.block.timestamp
  agent.save()
}

export function handleAgentUpdated(event: AgentUpdated): void {
  let addr = event.params.agent.toHexString()
  let agent = Agent.load(addr)
  if (agent == null) return

  agent.name = event.params.name
  agent.url = event.params.url
  agent.owner = event.params.owner
  agent.save()
}
