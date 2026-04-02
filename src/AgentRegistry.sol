// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IAgentRegistry} from "./interfaces/IAgentRegistry.sol";

contract AgentRegistry is IAgentRegistry {
    mapping(address => Agent) internal _agents;
    mapping(address => bool) internal _registered;

    bytes32 public immutable DOMAIN_SEPARATOR;
    bytes32 public constant REGISTER_TYPEHASH =
        keccak256("Register(address agent,string name,string url,address owner,uint256 nonce)");
    mapping(address => uint256) public nonces;

    constructor() {
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("AgentRegistry"),
                keccak256("1"),
                block.chainid,
                address(this)
            )
        );
    }

    function registerAgent(string calldata name, string calldata url, address owner) external {
        _register(msg.sender, name, url, owner);
    }

    function registerAgentWithSignature(
        address agent,
        string calldata name,
        string calldata url,
        address owner,
        bytes calldata signature
    ) external {
        uint256 nonce = nonces[agent]++;
        bytes32 structHash = keccak256(
            abi.encode(REGISTER_TYPEHASH, agent, keccak256(bytes(name)), keccak256(bytes(url)), owner, nonce)
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));

        require(signature.length == 65, "Invalid signature length");
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        address recovered = ecrecover(digest, v, r, s);
        require(recovered != address(0) && recovered == agent, "Invalid signature");

        _register(agent, name, url, owner);
    }

    function _register(address agent, string calldata name, string calldata url, address owner) internal {
        require(!_registered[agent], "Already registered");
        require(bytes(name).length > 0, "Name required");
        require(bytes(name).length <= 64, "Name too long");
        require(bytes(url).length <= 256, "URL too long");

        _agents[agent] = Agent({name: name, url: url, owner: owner, registeredAt: uint64(block.timestamp)});
        _registered[agent] = true;

        emit AgentRegistered(agent, name, url, owner);
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
