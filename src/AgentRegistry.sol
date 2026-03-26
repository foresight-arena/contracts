// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IAgentRegistry} from "./interfaces/IAgentRegistry.sol";

contract AgentRegistry is IAgentRegistry {
    mapping(address => Agent) internal _agents;
    mapping(address => bool) internal _registered;

    function registerAgent(string calldata name, string calldata url, address owner) external {
        require(!_registered[msg.sender], "Already registered");
        require(bytes(name).length > 0, "Name required");
        require(bytes(name).length <= 64, "Name too long");
        require(bytes(url).length <= 256, "URL too long");

        _agents[msg.sender] = Agent({name: name, url: url, owner: owner, registeredAt: uint64(block.timestamp)});
        _registered[msg.sender] = true;

        emit AgentRegistered(msg.sender, name, url, owner);
    }

    function updateAgent(string calldata name, string calldata url, address owner) external {
        require(_registered[msg.sender], "Not registered");
        require(bytes(name).length > 0, "Name required");
        require(bytes(name).length <= 64, "Name too long");
        require(bytes(url).length <= 256, "URL too long");

        Agent storage agent = _agents[msg.sender];
        agent.name = name;
        agent.url = url;
        agent.owner = owner;

        emit AgentUpdated(msg.sender, name, url, owner);
    }

    function isRegistered(address agent) external view returns (bool) {
        return _registered[agent];
    }

    function getAgent(address agent) external view returns (Agent memory) {
        return _agents[agent];
    }
}
