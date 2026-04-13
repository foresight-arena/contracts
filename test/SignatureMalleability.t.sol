// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {PredictionArena} from "../src/PredictionArena.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";
import {RoundManager} from "../src/RoundManager.sol";
import {MockConditionalTokens} from "./mocks/MockConditionalTokens.sol";

/**
 * @dev Tests that high-s ECDSA signatures (malleable) are rejected.
 *
 * For any valid signature (v, r, s), there exists a malleable counterpart
 * (v', r, secp256k1n - s) that recovers the same address. Without an
 * explicit s-range check, both are accepted by ecrecover.
 *
 * The secp256k1 curve order:
 *   n  = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
 *   n/2= 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0
 */
contract SignatureMalleabilityTest is Test {
    // secp256k1 curve order
    uint256 constant SECP256K1_N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
    uint256 constant SECP256K1_N_DIV_2 = 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;

    PredictionArena public arena;
    AgentRegistry public registry;
    RoundManager public roundManager;
    MockConditionalTokens public mockCtf;

    address admin = address(0xA);
    address curator = address(0xC);
    address relayer = address(0xBEEF);

    uint256 agentPk = 0x1234;
    address agent;

    bytes32 ARENA_DOMAIN_SEPARATOR;
    bytes32 REGISTRY_DOMAIN_SEPARATOR;

    bytes32 constant COMMIT_TYPEHASH =
        keccak256("Commit(uint256 roundId,bytes32 commitHash,address agent,uint256 nonce,uint256 deadline)");
    bytes32 constant REGISTER_TYPEHASH =
        keccak256("Register(address agent,string name,string url,address owner,uint256 nonce)");

    function setUp() public {
        vm.warp(1000000);
        agent = vm.addr(agentPk);

        mockCtf = new MockConditionalTokens();
        roundManager = new RoundManager(curator, admin);
        arena = new PredictionArena(address(roundManager), address(mockCtf), admin);
        registry = new AgentRegistry();

        ARENA_DOMAIN_SEPARATOR = arena.DOMAIN_SEPARATOR();
        REGISTRY_DOMAIN_SEPARATOR = registry.DOMAIN_SEPARATOR();
    }

    /// @dev Create a malleable (high-s) version of a signature.
    function _makeHighS(bytes memory sig) internal pure returns (bytes memory) {
        require(sig.length == 65, "bad sig len");
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }

        // Flip to high-s
        bytes32 highS = bytes32(SECP256K1_N - uint256(s));
        uint8 flippedV = v == 27 ? 28 : 27;

        return abi.encodePacked(r, highS, flippedV);
    }

    /// @dev Confirm that _makeHighS actually produces a valid malleable signature
    ///      that ecrecover accepts (proving the vulnerability exists pre-fix).
    function test_malleableSignatureRecovers() public {
        bytes32 digest = keccak256("test message");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(agentPk, digest);

        // Original recovers correctly
        address recovered1 = ecrecover(digest, v, r, s);
        assertEq(recovered1, agent);

        // Malleable version also recovers correctly (this is the vulnerability)
        bytes32 highS = bytes32(SECP256K1_N - uint256(s));
        uint8 flippedV = v == 27 ? 28 : 27;
        address recovered2 = ecrecover(digest, flippedV, r, highS);
        assertEq(recovered2, agent, "Malleable sig should recover same address");
    }

    // ---------------------------------------------------------------
    // PredictionArena — commitWithSignature
    // ---------------------------------------------------------------

    function test_commitWithSignature_rejectsMalleableSignature() public {
        // Create a round
        bytes32[] memory conditionIds = new bytes32[](2);
        conditionIds[0] = keccak256("market_0");
        conditionIds[1] = keccak256("market_1");
        vm.prank(curator);
        uint256 roundId =
            roundManager.createRound(conditionIds, uint64(block.timestamp) + 2 hours, uint64(block.timestamp) + 4 hours, uint64(block.timestamp) + 17 hours, 1);

        bytes32 commitHash = keccak256("commit_data");
        uint256 deadline = block.timestamp + 1 hours;
        uint256 nonce = arena.nonces(agent);

        // Sign normally
        bytes32 structHash = keccak256(abi.encode(COMMIT_TYPEHASH, roundId, commitHash, agent, nonce, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", ARENA_DOMAIN_SEPARATOR, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(agentPk, digest);
        bytes memory normalSig = abi.encodePacked(r, s, v);

        // Create malleable version
        bytes memory malleableSig = _makeHighS(normalSig);

        // Malleable signature should be rejected
        vm.prank(relayer);
        vm.expectRevert("Invalid signature");
        arena.commitWithSignature(roundId, commitHash, agent, deadline, malleableSig);

        // Normal signature should still work
        vm.prank(relayer);
        arena.commitWithSignature(roundId, commitHash, agent, deadline, normalSig);
        assertTrue(arena.hasCommitted(roundId, agent));
    }

    // ---------------------------------------------------------------
    // AgentRegistry — registerAgentWithSignature
    // ---------------------------------------------------------------

    function test_registerAgentWithSignature_rejectsMalleableSignature() public {
        string memory name = "TestAgent";
        string memory url = "";
        uint256 nonce = registry.nonces(agent);

        bytes32 structHash = keccak256(
            abi.encode(REGISTER_TYPEHASH, agent, keccak256(bytes(name)), keccak256(bytes(url)), agent, nonce)
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", REGISTRY_DOMAIN_SEPARATOR, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(agentPk, digest);
        bytes memory normalSig = abi.encodePacked(r, s, v);

        // Create malleable version
        bytes memory malleableSig = _makeHighS(normalSig);

        // Malleable signature should be rejected
        vm.prank(relayer);
        vm.expectRevert("Invalid signature");
        registry.registerAgentWithSignature(agent, name, url, agent, malleableSig);

        // Normal signature should still work
        vm.prank(relayer);
        registry.registerAgentWithSignature(agent, name, url, agent, normalSig);
        assertTrue(registry.isRegistered(agent));
    }
}
