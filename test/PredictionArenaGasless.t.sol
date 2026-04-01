// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {PredictionArena} from "../src/PredictionArena.sol";
import {IPredictionArena} from "../src/interfaces/IPredictionArena.sol";
import {RoundManager} from "../src/RoundManager.sol";

import {MockConditionalTokens} from "./mocks/MockConditionalTokens.sol";

contract PredictionArenaGaslessTest is Test {
    PredictionArena public arena;
    RoundManager public roundManager;
    MockConditionalTokens public mockCtf;

    address admin = address(0xA);
    address curator = address(0xC);
    address relayer = address(0xBEEF); // relayer pays gas

    // Agent key pair (for signing)
    uint256 agentPk = 0x1234;
    address agent;

    uint256 agent2Pk = 0x5678;
    address agent2;

    bytes32 DOMAIN_SEPARATOR;
    bytes32 constant COMMIT_TYPEHASH =
        keccak256("Commit(uint256 roundId,bytes32 commitHash,address agent,uint256 nonce,uint256 deadline)");
    bytes32 constant REVEAL_TYPEHASH = keccak256(
        "Reveal(uint256 roundId,bytes32 predictionsHash,bytes32 salt,address agent,uint256 nonce,uint256 deadline)"
    );

    event Committed(uint256 indexed roundId, address indexed agent, bytes32 commitHash);
    event Revealed(uint256 indexed roundId, address indexed agent, uint16[] predictions, uint16 scoredMarkets);
    event ScoreComputed(
        uint256 indexed roundId, address indexed agent, uint256 brierScore, int256 alphaScore, uint16 scoredMarkets
    );

    function setUp() public {
        vm.warp(1000000);

        agent = vm.addr(agentPk);
        agent2 = vm.addr(agent2Pk);

        mockCtf = new MockConditionalTokens();
        roundManager = new RoundManager(curator, admin);
        arena = new PredictionArena(address(roundManager), address(mockCtf), admin);

        DOMAIN_SEPARATOR = arena.DOMAIN_SEPARATOR();
    }

    // ---------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------

    function _createRound(uint256 numMarkets) internal returns (uint256 roundId) {
        bytes32[] memory conditionIds = new bytes32[](numMarkets);
        for (uint256 i = 0; i < numMarkets; i++) {
            conditionIds[i] = keccak256(abi.encodePacked("gasless_market_", i));
        }
        uint64 commitDeadline = uint64(block.timestamp) + 2 hours;
        uint64 revealDeadline = commitDeadline + 2 hours + 13 hours;
        vm.prank(curator);
        roundId = roundManager.createRound(conditionIds, commitDeadline, revealDeadline);
    }

    function _computeCommitHash(uint256 roundId, uint16[] memory predictions, bytes32 salt)
        internal
        pure
        returns (bytes32)
    {
        bytes memory packed = abi.encodePacked(roundId);
        for (uint256 i = 0; i < predictions.length; i++) {
            packed = abi.encodePacked(packed, predictions[i]);
        }
        return keccak256(abi.encodePacked(packed, salt));
    }

    function _signCommit(
        uint256 pk,
        uint256 roundId,
        bytes32 commitHash,
        address signer,
        uint256 nonce,
        uint256 deadline
    ) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(abi.encode(COMMIT_TYPEHASH, roundId, commitHash, signer, nonce, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _signReveal(
        uint256 pk,
        uint256 roundId,
        uint16[] memory predictions,
        bytes32 salt,
        address signer,
        uint256 nonce,
        uint256 deadline
    ) internal view returns (bytes memory) {
        bytes32 digest;
        {
            bytes memory packed;
            for (uint256 i = 0; i < predictions.length; i++) {
                packed = abi.encodePacked(packed, predictions[i]);
            }
            bytes32 structHash =
                keccak256(abi.encode(REVEAL_TYPEHASH, roundId, keccak256(packed), salt, signer, nonce, deadline));
            digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
        }
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    // ---------------------------------------------------------------
    // commitWithSignature
    // ---------------------------------------------------------------

    function test_commitWithSignature_success() public {
        uint256 roundId = _createRound(3);

        uint16[] memory preds = new uint16[](3);
        preds[0] = 8000;
        preds[1] = 5000;
        preds[2] = 2000;
        bytes32 salt = keccak256("gasless_salt");
        bytes32 commitHash = _computeCommitHash(roundId, preds, salt);

        uint256 deadline = block.timestamp + 1 hours;
        uint256 nonce = arena.nonces(agent);
        bytes memory sig = _signCommit(agentPk, roundId, commitHash, agent, nonce, deadline);

        // Relayer submits on behalf of agent
        vm.prank(relayer);
        vm.expectEmit(true, true, false, true);
        emit Committed(roundId, agent, commitHash);
        arena.commitWithSignature(roundId, commitHash, agent, deadline, sig);

        assertTrue(arena.hasCommitted(roundId, agent));
        assertEq(arena.nonces(agent), 1);
    }

    function test_commitWithSignature_expiredDeadline() public {
        uint256 roundId = _createRound(3);
        bytes32 commitHash = keccak256("test");
        uint256 deadline = block.timestamp - 1; // already expired
        bytes memory sig = _signCommit(agentPk, roundId, commitHash, agent, 0, deadline);

        vm.prank(relayer);
        vm.expectRevert("Signature expired");
        arena.commitWithSignature(roundId, commitHash, agent, deadline, sig);
    }

    function test_commitWithSignature_replayNonce() public {
        uint256 roundId1 = _createRound(3);
        uint256 roundId2 = _createRound(3);

        bytes32 commitHash1 = keccak256("hash1");
        bytes32 commitHash2 = keccak256("hash2");
        uint256 deadline = block.timestamp + 1 hours;

        // First commit uses nonce 0
        bytes memory sig1 = _signCommit(agentPk, roundId1, commitHash1, agent, 0, deadline);
        vm.prank(relayer);
        arena.commitWithSignature(roundId1, commitHash1, agent, deadline, sig1);

        // Try to reuse nonce 0 — should fail because nonce is now 1
        bytes memory sig2 = _signCommit(agentPk, roundId2, commitHash2, agent, 0, deadline);
        vm.prank(relayer);
        vm.expectRevert("Invalid signature");
        arena.commitWithSignature(roundId2, commitHash2, agent, deadline, sig2);

        // Using nonce 1 should work
        bytes memory sig3 = _signCommit(agentPk, roundId2, commitHash2, agent, 1, deadline);
        vm.prank(relayer);
        arena.commitWithSignature(roundId2, commitHash2, agent, deadline, sig3);
    }

    function test_commitWithSignature_wrongSigner() public {
        uint256 roundId = _createRound(3);
        bytes32 commitHash = keccak256("test");
        uint256 deadline = block.timestamp + 1 hours;

        // Sign with agent2's key but claim to be agent
        bytes memory sig = _signCommit(agent2Pk, roundId, commitHash, agent, 0, deadline);

        vm.prank(relayer);
        vm.expectRevert("Invalid signature");
        arena.commitWithSignature(roundId, commitHash, agent, deadline, sig);
    }

    // ---------------------------------------------------------------
    // revealWithSignature
    // ---------------------------------------------------------------

    function test_revealWithSignature_success() public {
        uint256 roundId = _createRound(3);

        uint16[] memory preds = new uint16[](3);
        preds[0] = 9000;
        preds[1] = 1000;
        preds[2] = 5000;
        bytes32 salt = keccak256("reveal_salt");
        bytes32 commitHash = _computeCommitHash(roundId, preds, salt);

        // Agent commits via signature (nonce 0)
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory commitSig = _signCommit(agentPk, roundId, commitHash, agent, 0, deadline);
        vm.prank(relayer);
        arena.commitWithSignature(roundId, commitHash, agent, deadline, commitSig);

        // Warp past commit deadline, post benchmarks
        vm.warp(block.timestamp + 2 hours + 1);
        uint16[] memory benchmarks = new uint16[](3);
        benchmarks[0] = 7000;
        benchmarks[1] = 3000;
        benchmarks[2] = 5000;
        vm.prank(curator);
        roundManager.postBenchmarkPrices(roundId, benchmarks);

        // Set mock oracle payouts
        uint256[] memory yes = new uint256[](2);
        yes[0] = 1;
        yes[1] = 0;
        uint256[] memory no = new uint256[](2);
        no[0] = 0;
        no[1] = 1;

        bytes32[] memory cids = new bytes32[](3);
        cids[0] = keccak256(abi.encodePacked("gasless_market_", uint256(0)));
        cids[1] = keccak256(abi.encodePacked("gasless_market_", uint256(1)));
        cids[2] = keccak256(abi.encodePacked("gasless_market_", uint256(2)));
        mockCtf.setPayouts(cids[0], yes);
        mockCtf.setPayouts(cids[1], no);
        mockCtf.setPayouts(cids[2], yes);

        // Warp to reveal phase
        vm.warp(block.timestamp + 2 hours + 1);

        // Agent reveals via signature (nonce 1)
        uint256 revealDeadline = block.timestamp + 1 hours;
        bytes memory revealSig = _signReveal(agentPk, roundId, preds, salt, agent, 1, revealDeadline);

        vm.prank(relayer);
        arena.revealWithSignature(roundId, preds, salt, agent, revealDeadline, revealSig);

        assertTrue(arena.hasRevealed(roundId, agent));
        IPredictionArena.Score memory score = arena.getScore(roundId, agent);
        assertEq(score.scoredMarkets, 3);
        assertTrue(score.brierScore > 0);
    }

    function test_revealWithSignature_expiredDeadline() public {
        uint256 roundId = _createRound(3);

        uint16[] memory preds = new uint16[](3);
        preds[0] = 5000;
        preds[1] = 5000;
        preds[2] = 5000;
        bytes32 salt = keccak256("test");

        uint256 deadline = block.timestamp - 1;
        bytes memory sig = _signReveal(agentPk, roundId, preds, salt, agent, 0, deadline);

        vm.prank(relayer);
        vm.expectRevert("Signature expired");
        arena.revealWithSignature(roundId, preds, salt, agent, deadline, sig);
    }

    function test_revealWithSignature_replayNonce() public {
        uint256 roundId = _createRound(3);

        uint16[] memory preds = new uint16[](3);
        preds[0] = 5000;
        preds[1] = 5000;
        preds[2] = 5000;
        bytes32 salt = keccak256("test");
        bytes32 commitHash = _computeCommitHash(roundId, preds, salt);

        // Commit directly (doesn't consume EIP-712 nonce)
        vm.prank(agent);
        arena.commit(roundId, commitHash);

        // Warp past commit + set up reveal phase
        vm.warp(block.timestamp + 2 hours + 1);
        uint16[] memory benchmarks = new uint16[](3);
        benchmarks[0] = 5000;
        benchmarks[1] = 5000;
        benchmarks[2] = 5000;
        vm.prank(curator);
        roundManager.postBenchmarkPrices(roundId, benchmarks);
        vm.warp(block.timestamp + 2 hours + 1);

        // Reveal with nonce 0 — succeeds
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _signReveal(agentPk, roundId, preds, salt, agent, 0, deadline);
        vm.prank(relayer);
        arena.revealWithSignature(roundId, preds, salt, agent, deadline, sig);

        // Same nonce 0 again — fails (nonce is now 1, and also already revealed)
        vm.prank(relayer);
        vm.expectRevert("Invalid signature");
        arena.revealWithSignature(roundId, preds, salt, agent, deadline, sig);
    }

    // ---------------------------------------------------------------
    // Mixed flows
    // ---------------------------------------------------------------

    function test_commitDirect_revealWithSignature() public {
        uint256 roundId = _createRound(3);

        uint16[] memory preds = new uint16[](3);
        preds[0] = 8000;
        preds[1] = 2000;
        preds[2] = 6000;
        bytes32 salt = keccak256("mixed");
        bytes32 commitHash = _computeCommitHash(roundId, preds, salt);

        // Agent commits directly (pays gas)
        vm.prank(agent);
        arena.commit(roundId, commitHash);

        // Warp and set up reveal phase
        vm.warp(block.timestamp + 2 hours + 1);
        uint16[] memory benchmarks = new uint16[](3);
        benchmarks[0] = 5000;
        benchmarks[1] = 5000;
        benchmarks[2] = 5000;
        vm.prank(curator);
        roundManager.postBenchmarkPrices(roundId, benchmarks);
        vm.warp(block.timestamp + 2 hours + 1);

        // Agent reveals via relayer (gasless) — nonce is still 0 since commit was direct
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _signReveal(agentPk, roundId, preds, salt, agent, 0, deadline);
        vm.prank(relayer);
        arena.revealWithSignature(roundId, preds, salt, agent, deadline, sig);

        assertTrue(arena.hasRevealed(roundId, agent));
    }

    function test_commitWithSignature_revealDirect() public {
        uint256 roundId = _createRound(3);

        uint16[] memory preds = new uint16[](3);
        preds[0] = 7000;
        preds[1] = 3000;
        preds[2] = 5000;
        bytes32 salt = keccak256("mixed2");
        bytes32 commitHash = _computeCommitHash(roundId, preds, salt);

        // Agent commits via relayer
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _signCommit(agentPk, roundId, commitHash, agent, 0, deadline);
        vm.prank(relayer);
        arena.commitWithSignature(roundId, commitHash, agent, deadline, sig);

        // Warp and set up reveal phase
        vm.warp(block.timestamp + 2 hours + 1);
        uint16[] memory benchmarks = new uint16[](3);
        benchmarks[0] = 5000;
        benchmarks[1] = 5000;
        benchmarks[2] = 5000;
        vm.prank(curator);
        roundManager.postBenchmarkPrices(roundId, benchmarks);
        vm.warp(block.timestamp + 2 hours + 1);

        // Agent reveals directly (pays gas)
        vm.prank(agent);
        arena.reveal(roundId, preds, salt);

        assertTrue(arena.hasRevealed(roundId, agent));
    }

    function test_originalCommitStillWorks() public {
        uint256 roundId = _createRound(3);
        bytes32 commitHash = keccak256("direct_test");

        vm.prank(agent);
        arena.commit(roundId, commitHash);

        assertTrue(arena.hasCommitted(roundId, agent));
        // EIP-712 nonce should not have changed
        assertEq(arena.nonces(agent), 0);
    }

    function test_twoAgentsGasless() public {
        uint256 roundId = _createRound(3);

        bytes32 hash1 = keccak256("agent1");
        bytes32 hash2 = keccak256("agent2");
        uint256 deadline = block.timestamp + 1 hours;

        bytes memory sig1 = _signCommit(agentPk, roundId, hash1, agent, 0, deadline);
        bytes memory sig2 = _signCommit(agent2Pk, roundId, hash2, agent2, 0, deadline);

        // Relayer submits both
        vm.startPrank(relayer);
        arena.commitWithSignature(roundId, hash1, agent, deadline, sig1);
        arena.commitWithSignature(roundId, hash2, agent2, deadline, sig2);
        vm.stopPrank();

        assertTrue(arena.hasCommitted(roundId, agent));
        assertTrue(arena.hasCommitted(roundId, agent2));
        assertEq(arena.getCommitCount(roundId), 2);
    }
}
