// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IAgentRegistry {
    struct Agent {
        string name;
        string url;
        address owner;
        uint64 registeredAt;
    }

    event AgentRegistered(address indexed agent, string name, string url, address owner);
    event AgentUpdated(address indexed agent, string name, string url, address owner);

    function registerAgent(string calldata name, string calldata url, address owner) external;
    function updateAgent(string calldata name, string calldata url, address owner) external;
    function isRegistered(address agent) external view returns (bool);
    function getAgent(address agent) external view returns (Agent memory);
}
