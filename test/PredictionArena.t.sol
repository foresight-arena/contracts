// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {PredictionArena} from "../src/PredictionArena.sol";
import {IPredictionArena} from "../src/interfaces/IPredictionArena.sol";
import {RoundManager} from "../src/RoundManager.sol";
import {IRoundManager} from "../src/interfaces/IRoundManager.sol";

import {MockConditionalTokens} from "./mocks/MockConditionalTokens.sol";

contract PredictionArenaTest is Test {
    PredictionArena public arena;
    RoundManager public roundManager;
    MockConditionalTokens public mockCtf;

    address admin = address(0xA);
    address curator = address(0xC);
    address agent1 = address(0x1);
    address agent2 = address(0x2);
    address agent3 = address(0x3);

    bytes32 constant SALT = keccak256("salt");
    bytes32 constant SALT2 = keccak256("salt2");

    event Committed(uint256 indexed roundId, address indexed agent, bytes32 commitHash, uint256 nonce);
    event Revealed(
        uint256 indexed roundId, address indexed agent, uint16[] predictions, uint16 scoredMarkets, uint256 nonce
    );
    event ScoreComputed(
        uint256 indexed roundId, address indexed agent, uint256 brierScore, int256 alphaScore, uint16 scoredMarkets
    );

    uint256 constant REBATE_PER_REVEAL = 0.001 ether;

    // Timing helpers
    uint64 constant COMMIT_WINDOW = 1 hours;
    uint64 constant REVEAL_START_BUFFER = 2 hours;
    uint64 constant REVEAL_WINDOW = 12 hours;

    function setUp() public {
        vm.warp(1000000);

        mockCtf = new MockConditionalTokens();
        roundManager = new RoundManager(curator, admin);
        arena = new PredictionArena(address(roundManager), address(mockCtf), admin);
    }

    // ---------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------

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

    /// @dev Create a round with `n` markets. Returns roundId and conditionIds.
    function _createRound(uint256 n) internal returns (uint256 roundId, bytes32[] memory conditionIds) {
        conditionIds = new bytes32[](n);
        for (uint256 i = 0; i < n; i++) {
            conditionIds[i] = keccak256(abi.encodePacked("condition", i));
        }

        uint64 commitDeadline = uint64(block.timestamp) + COMMIT_WINDOW + 1;
        uint64 revealStart = commitDeadline + REVEAL_START_BUFFER;
        uint64 revealDeadline = revealStart + REVEAL_WINDOW + 1;

        vm.prank(curator);
        roundId = roundManager.createRound(conditionIds, commitDeadline, revealStart, revealDeadline, 1);
    }

    /// @dev Create a standard 5-market round.
    function _createStandardRound() internal returns (uint256 roundId, bytes32[] memory conditionIds) {
        return _createRound(5);
    }

    /// @dev Post benchmark prices for a round (all set to `price`).
    function _postBenchmarks(uint256 roundId, uint256 n, uint16 price) internal {
        IRoundManager.Round memory r = roundManager.getRound(roundId);
        // Warp past commit deadline to post benchmarks
        vm.warp(r.commitDeadline);

        uint16[] memory benchmarks = new uint16[](n);
        for (uint256 i = 0; i < n; i++) {
            benchmarks[i] = price;
        }
        vm.prank(curator);
        roundManager.postBenchmarkPrices(roundId, benchmarks);
    }

    /// @dev Post custom benchmark prices.
    function _postCustomBenchmarks(uint256 roundId, uint16[] memory prices) internal {
        IRoundManager.Round memory r = roundManager.getRound(roundId);
        vm.warp(r.commitDeadline);

        vm.prank(curator);
        roundManager.postBenchmarkPrices(roundId, prices);
    }

    /// @dev Resolve a condition as YES (payout [1, 0]).
    function _resolveYes(bytes32 conditionId) internal {
        uint256[] memory payouts = new uint256[](2);
        payouts[0] = 1;
        payouts[1] = 0;
        mockCtf.setPayouts(conditionId, payouts);
    }

    /// @dev Resolve a condition as NO (payout [0, 1]).
    function _resolveNo(bytes32 conditionId) internal {
        uint256[] memory payouts = new uint256[](2);
        payouts[0] = 0;
        payouts[1] = 1;
        mockCtf.setPayouts(conditionId, payouts);
    }

    /// @dev Create predictions array filled with `value`.
    function _uniformPredictions(uint256 n, uint16 value) internal pure returns (uint16[] memory) {
        uint16[] memory preds = new uint16[](n);
        for (uint256 i = 0; i < n; i++) {
            preds[i] = value;
        }
        return preds;
    }

    /// @dev Commit for an agent.
    function _commitAs(address agent, uint256 roundId, bytes32 commitHash) internal {
        vm.prank(agent);
        arena.commit(roundId, commitHash);
    }

    /// @dev Full commit+reveal flow helper. Returns the score.
    function _commitAndReveal(address agent, uint256 roundId, uint16[] memory predictions, bytes32 salt)
        internal
        returns (IPredictionArena.Score memory)
    {
        bytes32 commitHash = _computeCommitHash(roundId, predictions, salt);
        _commitAs(agent, roundId, commitHash);

        // Warp to reveal phase
        IRoundManager.Round memory r = roundManager.getRound(roundId);
        vm.warp(r.revealStart);

        vm.prank(agent);
        arena.reveal(roundId, predictions, salt);

        return arena.getScore(roundId, agent);
    }

    // ===============================================================
    // COMMIT TESTS
    // ===============================================================

    function test_commit_success() public {
        (uint256 roundId,) = _createStandardRound();
        uint16[] memory preds = _uniformPredictions(5, 5000);
        bytes32 commitHash = _computeCommitHash(roundId, preds, SALT);

        vm.expectEmit(true, true, false, true);
        emit Committed(roundId, agent1, commitHash, type(uint256).max);

        vm.prank(agent1);
        arena.commit(roundId, commitHash);

        IPredictionArena.Commitment memory c = arena.getCommitment(roundId, agent1);
        assertEq(c.commitHash, commitHash);
        assertFalse(c.revealed);
        assertTrue(arena.hasCommitted(roundId, agent1));
        assertEq(arena.getCommitCount(roundId), 1);
    }

    function test_commit_noRegistrationRequired() public {
        (uint256 roundId,) = _createStandardRound();
        address unregistered = address(0xDEAD);
        uint16[] memory preds = _uniformPredictions(5, 5000);
        bytes32 commitHash = _computeCommitHash(roundId, preds, SALT);

        vm.prank(unregistered);
        arena.commit(roundId, commitHash);

        assertTrue(arena.hasCommitted(roundId, unregistered));
    }

    function test_commit_afterDeadline() public {
        (uint256 roundId,) = _createStandardRound();
        IRoundManager.Round memory r = roundManager.getRound(roundId);

        vm.warp(r.commitDeadline); // at deadline, should fail (require < deadline)
        bytes32 commitHash = keccak256("hash");

        vm.prank(agent1);
        vm.expectRevert("Commit phase ended");
        arena.commit(roundId, commitHash);
    }

    function test_commit_duplicateCommit() public {
        (uint256 roundId,) = _createStandardRound();
        bytes32 commitHash = keccak256("hash");

        vm.prank(agent1);
        arena.commit(roundId, commitHash);

        vm.prank(agent1);
        vm.expectRevert("Already committed");
        arena.commit(roundId, commitHash);
    }

    function test_commit_invalidRound() public {
        bytes32 commitHash = keccak256("hash");

        vm.prank(agent1);
        vm.expectRevert("Round does not exist");
        arena.commit(999, commitHash);
    }

    function test_commit_invalidatedRound() public {
        (uint256 roundId,) = _createStandardRound();

        vm.prank(admin);
        roundManager.invalidateRound(roundId);

        bytes32 commitHash = keccak256("hash");
        vm.prank(agent1);
        vm.expectRevert("Round invalidated");
        arena.commit(roundId, commitHash);
    }

    function test_commit_zeroHash() public {
        (uint256 roundId,) = _createStandardRound();

        vm.prank(agent1);
        vm.expectRevert("Empty hash");
        arena.commit(roundId, bytes32(0));
    }

    function test_commit_multipleAgents() public {
        (uint256 roundId,) = _createStandardRound();
        bytes32 h1 = keccak256("h1");
        bytes32 h2 = keccak256("h2");
        bytes32 h3 = keccak256("h3");

        vm.prank(agent1);
        arena.commit(roundId, h1);
        vm.prank(agent2);
        arena.commit(roundId, h2);
        vm.prank(agent3);
        arena.commit(roundId, h3);

        assertTrue(arena.hasCommitted(roundId, agent1));
        assertTrue(arena.hasCommitted(roundId, agent2));
        assertTrue(arena.hasCommitted(roundId, agent3));
        assertEq(arena.getCommitCount(roundId), 3);
    }

    function test_commit_multipleRounds() public {
        (uint256 r1,) = _createStandardRound();
        (uint256 r2,) = _createStandardRound();
        (uint256 r3,) = _createStandardRound();

        bytes32 h1 = keccak256("h1");
        bytes32 h2 = keccak256("h2");
        bytes32 h3 = keccak256("h3");

        vm.startPrank(agent1);
        arena.commit(r1, h1);
        arena.commit(r2, h2);
        arena.commit(r3, h3);
        vm.stopPrank();

        assertTrue(arena.hasCommitted(r1, agent1));
        assertTrue(arena.hasCommitted(r2, agent1));
        assertTrue(arena.hasCommitted(r3, agent1));
    }

    // ===============================================================
    // REVEAL TESTS
    // ===============================================================

    function test_reveal_success_allResolved() public {
        (uint256 roundId, bytes32[] memory cIds) = _createStandardRound();
        uint16[] memory preds = _uniformPredictions(5, 7000);
        bytes32 commitHash = _computeCommitHash(roundId, preds, SALT);

        vm.prank(agent1);
        arena.commit(roundId, commitHash);

        // Post benchmarks and resolve all markets as YES
        _postBenchmarks(roundId, 5, 5000);
        for (uint256 i = 0; i < 5; i++) {
            _resolveYes(cIds[i]);
        }

        IRoundManager.Round memory r = roundManager.getRound(roundId);
        vm.warp(r.revealStart);

        vm.expectEmit(true, true, false, true);
        emit Revealed(roundId, agent1, preds, 5, type(uint256).max);

        vm.expectEmit(true, true, false, true);
        // brierScore: (10000 - 7000)^2 = 9000000, alphaScore: (5000 - 10000)^2 - (7000 - 10000)^2 = 25000000 - 9000000 = 16000000
        emit ScoreComputed(roundId, agent1, 9000000, 16000000, 5);

        vm.prank(agent1);
        arena.reveal(roundId, preds, SALT);

        // Verify stored predictions
        uint16[] memory stored = arena.getRevealedPredictions(roundId, agent1);
        assertEq(stored.length, 5);
        for (uint256 i = 0; i < 5; i++) {
            assertEq(stored[i], 7000);
        }

        // Verify score
        IPredictionArena.Score memory s = arena.getScore(roundId, agent1);
        assertEq(s.brierScore, 9000000);
        assertEq(s.alphaScore, 16000000);
        assertEq(s.scoredMarkets, 5);
        assertEq(s.totalMarkets, 5);

        assertTrue(arena.hasRevealed(roundId, agent1));
    }

    function test_reveal_success_partialResolution() public {
        (uint256 roundId, bytes32[] memory cIds) = _createStandardRound();
        uint16[] memory preds = _uniformPredictions(5, 5000);
        bytes32 commitHash = _computeCommitHash(roundId, preds, SALT);

        vm.prank(agent1);
        arena.commit(roundId, commitHash);

        _postBenchmarks(roundId, 5, 5000);

        // Resolve only first 3
        for (uint256 i = 0; i < 3; i++) {
            _resolveYes(cIds[i]);
        }

        IRoundManager.Round memory r = roundManager.getRound(roundId);
        vm.warp(r.revealStart);

        vm.prank(agent1);
        arena.reveal(roundId, preds, SALT);

        IPredictionArena.Score memory s = arena.getScore(roundId, agent1);
        assertEq(s.scoredMarkets, 3);
        assertEq(s.totalMarkets, 5);
    }

    function test_reveal_success_noResolution() public {
        (uint256 roundId,) = _createStandardRound();
        uint16[] memory preds = _uniformPredictions(5, 5000);
        bytes32 commitHash = _computeCommitHash(roundId, preds, SALT);

        vm.prank(agent1);
        arena.commit(roundId, commitHash);

        _postBenchmarks(roundId, 5, 5000);

        // No markets resolved — should revert because minResolvedMarkets = 1
        IRoundManager.Round memory r = roundManager.getRound(roundId);
        vm.warp(r.revealStart);

        vm.prank(agent1);
        vm.expectRevert("Not enough markets resolved");
        arena.reveal(roundId, preds, SALT);
    }

    function test_reveal_hashMismatch() public {
        (uint256 roundId,) = _createStandardRound();
        uint16[] memory preds = _uniformPredictions(5, 5000);
        bytes32 commitHash = _computeCommitHash(roundId, preds, SALT);

        vm.prank(agent1);
        arena.commit(roundId, commitHash);

        _postBenchmarks(roundId, 5, 5000);
        IRoundManager.Round memory r = roundManager.getRound(roundId);
        vm.warp(r.revealStart);

        // Reveal with wrong salt
        vm.prank(agent1);
        vm.expectRevert("Hash mismatch");
        arena.reveal(roundId, preds, SALT2);
    }

    function test_reveal_beforeRevealStart() public {
        (uint256 roundId,) = _createStandardRound();
        uint16[] memory preds = _uniformPredictions(5, 5000);
        bytes32 commitHash = _computeCommitHash(roundId, preds, SALT);

        vm.prank(agent1);
        arena.commit(roundId, commitHash);

        _postBenchmarks(roundId, 5, 5000);

        IRoundManager.Round memory r = roundManager.getRound(roundId);
        // Warp to 1 second before reveal start
        vm.warp(r.revealStart - 1);

        vm.prank(agent1);
        vm.expectRevert("Reveal not started");
        arena.reveal(roundId, preds, SALT);
    }

    function test_reveal_afterRevealDeadline() public {
        (uint256 roundId,) = _createStandardRound();
        uint16[] memory preds = _uniformPredictions(5, 5000);
        bytes32 commitHash = _computeCommitHash(roundId, preds, SALT);

        vm.prank(agent1);
        arena.commit(roundId, commitHash);

        _postBenchmarks(roundId, 5, 5000);

        IRoundManager.Round memory r = roundManager.getRound(roundId);
        vm.warp(r.revealDeadline); // at deadline, should fail (require < deadline)

        vm.prank(agent1);
        vm.expectRevert("Reveal phase ended");
        arena.reveal(roundId, preds, SALT);
    }

    function test_reveal_withoutCommit() public {
        (uint256 roundId,) = _createStandardRound();
        uint16[] memory preds = _uniformPredictions(5, 5000);

        _postBenchmarks(roundId, 5, 5000);
        IRoundManager.Round memory r = roundManager.getRound(roundId);
        vm.warp(r.revealStart);

        vm.prank(agent1);
        vm.expectRevert("No commitment");
        arena.reveal(roundId, preds, SALT);
    }

    function test_reveal_duplicate() public {
        (uint256 roundId, bytes32[] memory cIds) = _createStandardRound();
        uint16[] memory preds = _uniformPredictions(5, 5000);
        bytes32 commitHash = _computeCommitHash(roundId, preds, SALT);

        vm.prank(agent1);
        arena.commit(roundId, commitHash);

        _postBenchmarks(roundId, 5, 5000);
        _resolveYes(cIds[0]); // resolve at least 1 market

        IRoundManager.Round memory r = roundManager.getRound(roundId);
        vm.warp(r.revealStart);

        vm.prank(agent1);
        arena.reveal(roundId, preds, SALT);

        vm.prank(agent1);
        vm.expectRevert("Already revealed");
        arena.reveal(roundId, preds, SALT);
    }

    function test_reveal_wrongPredictionCount() public {
        (uint256 roundId,) = _createStandardRound();
        // Commit with 5 predictions but try to reveal with 3
        uint16[] memory correctPreds = _uniformPredictions(5, 5000);
        bytes32 commitHash = _computeCommitHash(roundId, correctPreds, SALT);

        vm.prank(agent1);
        arena.commit(roundId, commitHash);

        _postBenchmarks(roundId, 5, 5000);
        IRoundManager.Round memory r = roundManager.getRound(roundId);
        vm.warp(r.revealStart);

        uint16[] memory wrongPreds = _uniformPredictions(3, 5000);

        vm.prank(agent1);
        vm.expectRevert("Wrong prediction count");
        arena.reveal(roundId, wrongPreds, SALT);
    }

    function test_reveal_predictionOutOfRange() public {
        (uint256 roundId,) = _createStandardRound();
        uint16[] memory preds = new uint16[](5);
        preds[0] = 5000;
        preds[1] = 5000;
        preds[2] = 10001; // out of range
        preds[3] = 5000;
        preds[4] = 5000;
        bytes32 commitHash = _computeCommitHash(roundId, preds, SALT);

        vm.prank(agent1);
        arena.commit(roundId, commitHash);

        _postBenchmarks(roundId, 5, 5000);
        IRoundManager.Round memory r = roundManager.getRound(roundId);
        vm.warp(r.revealStart);

        vm.prank(agent1);
        vm.expectRevert("Prediction out of range");
        arena.reveal(roundId, preds, SALT);
    }

    function test_reveal_benchmarksNotPosted() public {
        (uint256 roundId,) = _createStandardRound();
        uint16[] memory preds = _uniformPredictions(5, 5000);
        bytes32 commitHash = _computeCommitHash(roundId, preds, SALT);

        vm.prank(agent1);
        arena.commit(roundId, commitHash);

        // Don't post benchmarks; warp past commit deadline + oracle buffer
        IRoundManager.Round memory r = roundManager.getRound(roundId);
        vm.warp(r.revealStart);

        vm.prank(agent1);
        vm.expectRevert("Benchmarks not posted");
        arena.reveal(roundId, preds, SALT);
    }

    function test_reveal_invalidatedRound() public {
        (uint256 roundId,) = _createStandardRound();
        uint16[] memory preds = _uniformPredictions(5, 5000);
        bytes32 commitHash = _computeCommitHash(roundId, preds, SALT);

        vm.prank(agent1);
        arena.commit(roundId, commitHash);

        _postBenchmarks(roundId, 5, 5000);

        vm.prank(admin);
        roundManager.invalidateRound(roundId);

        IRoundManager.Round memory r = roundManager.getRound(roundId);
        vm.warp(r.revealStart);

        vm.prank(agent1);
        vm.expectRevert("Round invalidated");
        arena.reveal(roundId, preds, SALT);
    }

    // ===============================================================
    // SCORING TESTS
    // ===============================================================

    function test_scoring_perfectPrediction() public {
        (uint256 roundId, bytes32[] memory cIds) = _createRound(1);
        uint16[] memory preds = _uniformPredictions(1, 10000); // predict YES with certainty
        bytes32 commitHash = _computeCommitHash(roundId, preds, SALT);

        vm.prank(agent1);
        arena.commit(roundId, commitHash);

        _postBenchmarks(roundId, 1, 5000);
        _resolveYes(cIds[0]); // outcome = 10000

        IRoundManager.Round memory r = roundManager.getRound(roundId);
        vm.warp(r.revealStart);

        vm.prank(agent1);
        arena.reveal(roundId, preds, SALT);

        IPredictionArena.Score memory s = arena.getScore(roundId, agent1);
        // (10000 - 10000)^2 = 0
        assertEq(s.brierScore, 0);
    }

    function test_scoring_worstPrediction() public {
        (uint256 roundId, bytes32[] memory cIds) = _createRound(1);
        uint16[] memory preds = _uniformPredictions(1, 0); // predict NO with certainty
        bytes32 commitHash = _computeCommitHash(roundId, preds, SALT);

        vm.prank(agent1);
        arena.commit(roundId, commitHash);

        _postBenchmarks(roundId, 1, 5000);
        _resolveYes(cIds[0]); // outcome = 10000

        IRoundManager.Round memory r = roundManager.getRound(roundId);
        vm.warp(r.revealStart);

        vm.prank(agent1);
        arena.reveal(roundId, preds, SALT);

        IPredictionArena.Score memory s = arena.getScore(roundId, agent1);
        // (0 - 10000)^2 = 100000000
        assertEq(s.brierScore, 100000000);
    }

    function test_scoring_midPrediction() public {
        (uint256 roundId, bytes32[] memory cIds) = _createRound(1);
        uint16[] memory preds = _uniformPredictions(1, 5000);
        bytes32 commitHash = _computeCommitHash(roundId, preds, SALT);

        vm.prank(agent1);
        arena.commit(roundId, commitHash);

        _postBenchmarks(roundId, 1, 5000);
        _resolveYes(cIds[0]); // outcome = 10000

        IRoundManager.Round memory r = roundManager.getRound(roundId);
        vm.warp(r.revealStart);

        vm.prank(agent1);
        arena.reveal(roundId, preds, SALT);

        IPredictionArena.Score memory s = arena.getScore(roundId, agent1);
        // (5000 - 10000)^2 = 25000000
        assertEq(s.brierScore, 25000000);
    }

    function test_scoring_alphaPositive() public {
        // Agent predicts better than benchmark
        (uint256 roundId, bytes32[] memory cIds) = _createRound(1);
        uint16[] memory preds = _uniformPredictions(1, 9000); // closer to YES
        bytes32 commitHash = _computeCommitHash(roundId, preds, SALT);

        vm.prank(agent1);
        arena.commit(roundId, commitHash);

        _postBenchmarks(roundId, 1, 5000); // benchmark at 5000
        _resolveYes(cIds[0]); // outcome = 10000

        IRoundManager.Round memory r = roundManager.getRound(roundId);
        vm.warp(r.revealStart);

        vm.prank(agent1);
        arena.reveal(roundId, preds, SALT);

        IPredictionArena.Score memory s = arena.getScore(roundId, agent1);
        // benchmarkBrier = (5000 - 10000)^2 = 25000000
        // agentBrier = (9000 - 10000)^2 = 1000000
        // alpha = 25000000 - 1000000 = 24000000
        assertGt(s.alphaScore, 0);
        assertEq(s.alphaScore, 24000000);
    }

    function test_scoring_alphaZero() public {
        // Agent predicts same as benchmark
        (uint256 roundId, bytes32[] memory cIds) = _createRound(1);
        uint16[] memory preds = _uniformPredictions(1, 5000);
        bytes32 commitHash = _computeCommitHash(roundId, preds, SALT);

        vm.prank(agent1);
        arena.commit(roundId, commitHash);

        _postBenchmarks(roundId, 1, 5000);
        _resolveYes(cIds[0]);

        IRoundManager.Round memory r = roundManager.getRound(roundId);
        vm.warp(r.revealStart);

        vm.prank(agent1);
        arena.reveal(roundId, preds, SALT);

        IPredictionArena.Score memory s = arena.getScore(roundId, agent1);
        assertEq(s.alphaScore, 0);
    }

    function test_scoring_alphaNegative() public {
        // Agent predicts worse than benchmark
        (uint256 roundId, bytes32[] memory cIds) = _createRound(1);
        uint16[] memory preds = _uniformPredictions(1, 1000); // far from YES
        bytes32 commitHash = _computeCommitHash(roundId, preds, SALT);

        vm.prank(agent1);
        arena.commit(roundId, commitHash);

        _postBenchmarks(roundId, 1, 5000);
        _resolveYes(cIds[0]); // outcome = 10000

        IRoundManager.Round memory r = roundManager.getRound(roundId);
        vm.warp(r.revealStart);

        vm.prank(agent1);
        arena.reveal(roundId, preds, SALT);

        IPredictionArena.Score memory s = arena.getScore(roundId, agent1);
        // benchmarkBrier = (5000 - 10000)^2 = 25000000
        // agentBrier = (1000 - 10000)^2 = 81000000
        // alpha = 25000000 - 81000000 = -56000000
        assertLt(s.alphaScore, 0);
        assertEq(s.alphaScore, -56000000);
    }

    function test_scoring_multipleMarkets() public {
        (uint256 roundId, bytes32[] memory cIds) = _createStandardRound();

        uint16[] memory preds = new uint16[](5);
        preds[0] = 9000; // YES outcome
        preds[1] = 2000; // NO outcome
        preds[2] = 7000; // YES outcome
        preds[3] = 3000; // NO outcome
        preds[4] = 5000; // YES outcome

        bytes32 commitHash = _computeCommitHash(roundId, preds, SALT);

        vm.prank(agent1);
        arena.commit(roundId, commitHash);

        _postBenchmarks(roundId, 5, 5000);

        // Resolve: YES, NO, YES, NO, YES
        _resolveYes(cIds[0]);
        _resolveNo(cIds[1]);
        _resolveYes(cIds[2]);
        _resolveNo(cIds[3]);
        _resolveYes(cIds[4]);

        IRoundManager.Round memory r = roundManager.getRound(roundId);
        vm.warp(r.revealStart);

        vm.prank(agent1);
        arena.reveal(roundId, preds, SALT);

        IPredictionArena.Score memory s = arena.getScore(roundId, agent1);
        assertEq(s.scoredMarkets, 5);
        assertEq(s.totalMarkets, 5);

        // Market 0: (9000 - 10000)^2 = 1000000
        // Market 1: (2000 - 0)^2 = 4000000
        // Market 2: (7000 - 10000)^2 = 9000000
        // Market 3: (3000 - 0)^2 = 9000000
        // Market 4: (5000 - 10000)^2 = 25000000
        // Total = 48000000, avg = 48000000 / 5 = 9600000
        assertEq(s.brierScore, 9600000);

        // Benchmark all 5000:
        // Market 0: (5000 - 10000)^2 = 25000000
        // Market 1: (5000 - 0)^2 = 25000000
        // Market 2: (5000 - 10000)^2 = 25000000
        // Market 3: (5000 - 0)^2 = 25000000
        // Market 4: (5000 - 10000)^2 = 25000000
        // benchTotal = 125000000
        // alphaTotal = 125000000 - 48000000 = 77000000, avg = 77000000 / 5 = 15400000
        assertEq(s.alphaScore, 15400000);
    }

    function test_scoring_skippedMarkets() public {
        (uint256 roundId, bytes32[] memory cIds) = _createStandardRound();
        uint16[] memory preds = _uniformPredictions(5, 8000);
        bytes32 commitHash = _computeCommitHash(roundId, preds, SALT);

        vm.prank(agent1);
        arena.commit(roundId, commitHash);

        _postBenchmarks(roundId, 5, 5000);

        // Resolve only first 3 as YES, leave 2 unresolved
        _resolveYes(cIds[0]);
        _resolveYes(cIds[1]);
        _resolveYes(cIds[2]);

        IRoundManager.Round memory r = roundManager.getRound(roundId);
        vm.warp(r.revealStart);

        vm.prank(agent1);
        arena.reveal(roundId, preds, SALT);

        IPredictionArena.Score memory s = arena.getScore(roundId, agent1);
        assertEq(s.scoredMarkets, 3);
        assertEq(s.totalMarkets, 5);

        // Each resolved market: (8000 - 10000)^2 = 4000000
        // avg = 4000000 * 3 / 3 = 4000000
        assertEq(s.brierScore, 4000000);

        // Benchmark: (5000 - 10000)^2 = 25000000 each
        // alpha per market: 25000000 - 4000000 = 21000000
        // avg = 21000000 * 3 / 3 = 21000000
        assertEq(s.alphaScore, 21000000);
    }

    function test_scoring_baselineFollower() public {
        // Agent submits benchmark prices as predictions
        (uint256 roundId, bytes32[] memory cIds) = _createStandardRound();

        uint16[] memory benchmarks = new uint16[](5);
        benchmarks[0] = 6000;
        benchmarks[1] = 4000;
        benchmarks[2] = 7500;
        benchmarks[3] = 3000;
        benchmarks[4] = 5000;

        // Agent uses same values as benchmark
        uint16[] memory preds = new uint16[](5);
        preds[0] = 6000;
        preds[1] = 4000;
        preds[2] = 7500;
        preds[3] = 3000;
        preds[4] = 5000;

        bytes32 commitHash = _computeCommitHash(roundId, preds, SALT);

        vm.prank(agent1);
        arena.commit(roundId, commitHash);

        _postCustomBenchmarks(roundId, benchmarks);

        for (uint256 i = 0; i < 5; i++) {
            _resolveYes(cIds[i]);
        }

        IRoundManager.Round memory r = roundManager.getRound(roundId);
        vm.warp(r.revealStart);

        vm.prank(agent1);
        arena.reveal(roundId, preds, SALT);

        IPredictionArena.Score memory s = arena.getScore(roundId, agent1);
        // alpha should be 0 since prediction == benchmark for every market
        assertEq(s.alphaScore, 0);
    }

    // ===============================================================
    // COMMIT HASH TESTS
    // ===============================================================

    function test_commitHash_differentSalt() public {
        uint16[] memory preds = _uniformPredictions(5, 5000);
        bytes32 h1 = _computeCommitHash(1, preds, SALT);
        bytes32 h2 = _computeCommitHash(1, preds, SALT2);
        assertTrue(h1 != h2);
    }

    function test_commitHash_differentPredictions() public {
        uint16[] memory preds1 = _uniformPredictions(5, 5000);
        uint16[] memory preds2 = _uniformPredictions(5, 6000);
        bytes32 h1 = _computeCommitHash(1, preds1, SALT);
        bytes32 h2 = _computeCommitHash(1, preds2, SALT);
        assertTrue(h1 != h2);
    }

    function test_commitHash_differentRound() public {
        uint16[] memory preds = _uniformPredictions(5, 5000);
        bytes32 h1 = _computeCommitHash(1, preds, SALT);
        bytes32 h2 = _computeCommitHash(2, preds, SALT);
        assertTrue(h1 != h2);
    }
}
