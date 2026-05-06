import { BigInt } from "@graphprotocol/graph-ts"
import {
  Registered,
  URIUpdated,
  Transfer,
} from "../generated/IdentityRegistry/IdentityRegistry"
import { Agent } from "../generated/schema"
import { KNOWN_RELAYER_ADDRESSES } from "./config"

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"

function isRelayerAddress(addrLowerHex: string): boolean {
  for (let i = 0; i < KNOWN_RELAYER_ADDRESSES.length; i++) {
    if (KNOWN_RELAYER_ADDRESSES[i] == addrLowerHex) return true
  }
  return false
}

export function handleRegistered(event: Registered): void {
  let owner = event.params.owner
  let ownerHex = owner.toHexString()

  // Upsert Agent entity keyed by owner address
  let agent = Agent.load(ownerHex)
  if (agent == null) {
    agent = new Agent(ownerHex)
    agent.address = owner
    agent.owner = owner
    agent.totalBrierScore = BigInt.zero()
    agent.totalAlphaScore = BigInt.zero()
    agent.scoredRoundCount = 0
    agent.gaslessNonce = 0
    agent.lastActiveTimestamp = BigInt.zero()
    agent.registeredAt = event.block.timestamp
    // Default to DIRECT; the Transfer handler upgrades to RELAYER if our
    // wallet was the original minter and forwarded the NFT to the agent.
    // The mint case where owner itself is a relayer wallet is rare (we never
    // keep NFTs on the relayer long-term) but we tag it for completeness.
    agent.registrationOrigin = isRelayerAddress(ownerHex) ? "RELAYER" : "DIRECT"
  }

  agent.agentId = event.params.agentId
  agent.agentURI = event.params.agentURI
  agent.owner = owner
  agent.save()
}

export function handleURIUpdated(event: URIUpdated): void {
  // We only have updatedBy (typically the owner) and agentId in the event.
  // Look up the agent using the updatedBy address and verify the agentId matches.
  let updatedBy = event.params.updatedBy.toHexString()
  let agent = Agent.load(updatedBy)
  if (agent == null) return
  if (agent.agentId === null) return
  let currentAgentId = agent.agentId
  if (currentAgentId === null) return
  if (!currentAgentId.equals(event.params.agentId)) return

  agent.agentURI = event.params.newURI
  agent.save()
}

export function handleTransfer(event: Transfer): void {
  let fromHex = event.params.from.toHexString()
  let toHex = event.params.to.toHexString()

  // Skip mint (handled by Registered) and burn — only handle transfers between non-zero addresses.
  if (fromHex == ZERO_ADDRESS) return
  if (toHex == ZERO_ADDRESS) return

  let oldAgent = Agent.load(fromHex)
  if (oldAgent == null) return
  let oldAgentId = oldAgent.agentId
  if (oldAgentId === null) return
  if (!oldAgentId.equals(event.params.tokenId)) return

  // Move the NFT identity to the new owner.
  let newAgent = Agent.load(toHex)
  if (newAgent == null) {
    newAgent = new Agent(toHex)
    newAgent.address = event.params.to
    newAgent.totalBrierScore = BigInt.zero()
    newAgent.totalAlphaScore = BigInt.zero()
    newAgent.scoredRoundCount = 0
    newAgent.gaslessNonce = 0
    newAgent.lastActiveTimestamp = BigInt.zero()
    newAgent.registeredAt = oldAgent.registeredAt
    newAgent.registrationOrigin = "DIRECT"
  }
  newAgent.agentId = oldAgent.agentId
  newAgent.agentURI = oldAgent.agentURI
  newAgent.owner = event.params.to

  // The relayer's onboarding flow is "register() to relayer + transferFrom
  // relayer -> agent". A transfer from a known relayer wallet means the
  // recipient was onboarded by us; tag it.
  if (isRelayerAddress(fromHex)) {
    newAgent.registrationOrigin = "RELAYER"
  }

  newAgent.save()

  // The old address no longer owns this NFT — clear its identity fields
  // but preserve AgentRound history and reputation aggregates.
  oldAgent.agentId = null
  oldAgent.agentURI = null
  oldAgent.save()
}
