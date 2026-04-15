// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IAgentNFT {
    struct AgentInfo {
        string name;
        string url;
        string model;
        address owner;
        uint64 registeredAt;
    }

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event AgentRegistered(uint256 indexed agentId, address indexed owner, string name, string model);
    event AgentUpdated(uint256 indexed agentId, string name, string url, string model);

    function register(string calldata name, string calldata url, string calldata model) external returns (uint256);
    function registerWithSignature(
        address agent,
        string calldata name,
        string calldata url,
        string calldata model,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external returns (uint256);

    function updateMetadata(string calldata name, string calldata url, string calldata model) external;

    // ERC-721 views (minimal, soulbound)
    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
    function balanceOf(address owner) external view returns (uint256);
    function ownerOf(uint256 tokenId) external view returns (address);
    function tokenURI(uint256 tokenId) external view returns (string memory);

    // Agent-specific views
    function agentIdOf(address agent) external view returns (uint256);
    function getAgent(uint256 agentId) external view returns (AgentInfo memory);
    function totalSupply() external view returns (uint256);
    function nonces(address agent) external view returns (uint256);

    function supportsInterface(bytes4 interfaceId) external view returns (bool);
}
