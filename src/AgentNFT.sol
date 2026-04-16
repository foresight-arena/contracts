// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IAgentNFT} from "./interfaces/IAgentNFT.sol";

/// @title AgentNFT — Soulbound ERC-721 identity for Foresight Arena agents
/// @notice Each agent gets a non-transferable NFT with on-chain metadata.
///         Supports gasless registration via EIP-712 signatures.
///         Token URI points to the relayer for dynamic metadata + SVG image.
contract AgentNFT is IAgentNFT {
    // ---------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------

    string public baseURI;

    uint256 private _nextId;
    mapping(uint256 => AgentInfo) internal _agents;
    mapping(address => uint256) internal _agentIds; // address → tokenId (0 = not registered)

    // EIP-712 gasless support
    bytes32 public immutable DOMAIN_SEPARATOR;
    mapping(address => uint256) public nonces;

    bytes32 public constant REGISTER_TYPEHASH =
        keccak256("Register(address agent,string name,string url,uint256 nonce,uint256 deadline)");

    // ERC-165 interface IDs
    bytes4 private constant ERC721_INTERFACE = 0x80ac58cd;
    bytes4 private constant ERC721_METADATA_INTERFACE = 0x5b5e139f;
    bytes4 private constant ERC165_INTERFACE = 0x01ffc9a7;

    // ---------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------

    constructor(string memory baseURI_) {
        baseURI = baseURI_;
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("AgentNFT"),
                keccak256("1"),
                block.chainid,
                address(this)
            )
        );
    }

    // ---------------------------------------------------------------
    // Registration
    // ---------------------------------------------------------------

    function register(string calldata agentName, string calldata url) external returns (uint256) {
        return _register(msg.sender, agentName, url);
    }

    function registerWithSignature(
        address agent,
        string calldata agentName,
        string calldata url,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external returns (uint256) {
        require(block.timestamp <= deadline, "Signature expired");
        require(nonce == nonces[agent], "Invalid nonce");
        nonces[agent]++;

        bytes32 structHash = keccak256(
            abi.encode(REGISTER_TYPEHASH, agent, keccak256(bytes(agentName)), keccak256(bytes(url)), nonce, deadline)
        );

        _verifySignature(agent, structHash, signature);
        return _register(agent, agentName, url);
    }

    function _register(address agent, string calldata agentName, string calldata url)
        internal
        returns (uint256 agentId)
    {
        require(_agentIds[agent] == 0, "Already registered");
        require(bytes(agentName).length > 0 && bytes(agentName).length <= 64, "Invalid name length");
        require(bytes(url).length <= 256, "URL too long");

        agentId = ++_nextId;
        _agents[agentId] = AgentInfo({name: agentName, url: url, owner: agent, registeredAt: uint64(block.timestamp)});
        _agentIds[agent] = agentId;

        // ERC-721 Transfer event (mint)
        emit Transfer(address(0), agent, agentId);
        emit AgentRegistered(agentId, agent, agentName, url);
    }

    // ---------------------------------------------------------------
    // Metadata updates
    // ---------------------------------------------------------------

    function updateMetadata(string calldata agentName, string calldata url) external {
        uint256 agentId = _agentIds[msg.sender];
        require(agentId != 0, "Not registered");
        require(bytes(agentName).length > 0 && bytes(agentName).length <= 64, "Invalid name length");
        require(bytes(url).length <= 256, "URL too long");

        AgentInfo storage a = _agents[agentId];
        a.name = agentName;
        a.url = url;

        emit AgentUpdated(agentId, agentName, url);
    }

    // ---------------------------------------------------------------
    // EIP-712 signature verification
    // ---------------------------------------------------------------

    function _verifySignature(address expected, bytes32 structHash, bytes calldata signature) internal view {
        require(signature.length == 65, "Invalid signature length");

        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));

        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }

        // Reject malleable signatures
        require(uint256(s) <= 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0, "Invalid signature");

        address recovered = ecrecover(digest, v, r, s);
        require(recovered != address(0) && recovered == expected, "Invalid signature");
    }

    // ---------------------------------------------------------------
    // ERC-721 views (soulbound — no transfer functions)
    // ---------------------------------------------------------------

    function name() external pure returns (string memory) {
        return "Foresight Arena Agent";
    }

    function symbol() external pure returns (string memory) {
        return "FSA-AGENT";
    }

    function balanceOf(address owner) external view returns (uint256) {
        return _agentIds[owner] != 0 ? 1 : 0;
    }

    function ownerOf(uint256 tokenId) external view returns (address) {
        address owner = _agents[tokenId].owner;
        require(owner != address(0), "Token does not exist");
        return owner;
    }

    function tokenURI(uint256 tokenId) external view returns (string memory) {
        require(_agents[tokenId].owner != address(0), "Token does not exist");
        return string(abi.encodePacked(baseURI, _toString(tokenId)));
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return
            interfaceId == ERC721_INTERFACE || interfaceId == ERC721_METADATA_INTERFACE
                || interfaceId == ERC165_INTERFACE;
    }

    // ---------------------------------------------------------------
    // Agent-specific views
    // ---------------------------------------------------------------

    function agentIdOf(address agent) external view returns (uint256) {
        return _agentIds[agent];
    }

    function getAgent(uint256 agentId) external view returns (AgentInfo memory) {
        return _agents[agentId];
    }

    function totalSupply() external view returns (uint256) {
        return _nextId;
    }

    // ---------------------------------------------------------------
    // Internal helpers
    // ---------------------------------------------------------------

    function _toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits--;
            buffer[digits] = bytes1(uint8(48 + value % 10));
            value /= 10;
        }
        return string(buffer);
    }
}
