import { BigInt } from "@graphprotocol/graph-ts"
import {
  AgentRegistered,
  AgentUpdated,
} from "../generated/AgentNFT/AgentNFT"
import { Agent } from "../generated/schema"

export function handleAgentRegistered(event: AgentRegistered): void {
  let addr = event.params.owner.toHexString()

  let agent = Agent.load(addr)
  if (agent == null) {
    agent = new Agent(addr)
    agent.address = event.params.owner
    agent.totalBrierScore = BigInt.zero()
    agent.totalAlphaScore = BigInt.zero()
    agent.scoredRoundCount = 0
    agent.gaslessNonce = 0
    agent.lastActiveTimestamp = BigInt.zero()
    agent.url = ""
  }

  agent.agentId = event.params.agentId
  agent.name = event.params.name
  agent.model = event.params.model
  agent.owner = event.params.owner
  agent.registeredAt = event.block.timestamp
  agent.save()
}

export function handleAgentUpdated(event: AgentUpdated): void {
  // AgentUpdated is keyed by agentId — we need to find the agent
  // Since we don't have the owner address in the event, we iterate by agentId
  // For now, we store a mapping via agentId. We need to look up the agent.
  // The entity ID is the owner address (lowercase hex), but AgentUpdated only has agentId.
  // We'll need to search by agentId — use the transaction sender as a fallback.
  let addr = event.transaction.from.toHexString()
  let agent = Agent.load(addr)
  if (agent == null) return

  agent.name = event.params.name
  agent.url = event.params.url
  agent.model = event.params.model
  agent.save()
}
