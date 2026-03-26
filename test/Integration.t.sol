// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {PredictionArena} from "../src/PredictionArena.sol";
import {IPredictionArena} from "../src/interfaces/IPredictionArena.sol";
import {RoundManager} from "../src/RoundManager.sol";
import {IRoundManager} from "../src/interfaces/IRoundManager.sol";
import {GasRebate} from "../src/GasRebate.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";
import {MockConditionalTokens} from "./mocks/MockConditionalTokens.sol";

contract IntegrationTest is Test {
    PredictionArena public arena;
    RoundManager public roundManager;
    GasRebate public gasRebate;
    AgentRegistry public registry;
    MockConditionalTokens public mockCtf;

    address public curator = makeAddr("curator");
    address public admin = makeAddr("admin");
    address public agent1 = makeAddr("agent1");
    address public agent2 = makeAddr("agent2");
    address public agent3 = makeAddr("agent3");

    uint256 public constant REBATE_PER_REVEAL = 0.01 ether;

    bytes32[] public conditionIds;

    function setUp() public {
        // Deploy all contracts
        mockCtf = new MockConditionalTokens();
        registry = new AgentRegistry();
        roundManager = new RoundManager(curator, admin);
        gasRebate = new GasRebate(admin, address(0), REBATE_PER_REVEAL);
        arena = new PredictionArena(address(roundManager), address(mockCtf), address(gasRebate), admin);

        // Wire up gasRebate to arena
        vm.prank(admin);
        gasRebate.setPredictionArena(address(arena));

        // Fund gasRebate treasury
        vm.deal(address(this), 10 ether);
        gasRebate.fundTreasury{value: 10 ether}();

        // Setup 5 condition IDs
        conditionIds.push(keccak256("market1"));
        conditionIds.push(keccak256("market2"));
        conditionIds.push(keccak256("market3"));
        conditionIds.push(keccak256("market4"));
        conditionIds.push(keccak256("market5"));
    }

    // ---------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------

    function _computeCommitHash(uint256 roundId, uint16[] memory predictions, bytes32 salt)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encodePacked(roundId, predictions, salt));
    }

    /// @dev Creates a round with the stored conditionIds and reasonable deadlines.
    ///      Returns (roundId, commitDeadline, revealStart, revealDeadline).
    function _createDefaultRound()
        internal
        returns (uint256 roundId, uint64 commitDeadline, uint64 revealStart, uint64 revealDeadline)
    {
        commitDeadline = uint64(block.timestamp) + 2 hours;
        revealDeadline = commitDeadline + 2 hours + 13 hours; // > ORACLE_BUFFER + MIN_REVEAL_WINDOW
        revealStart = commitDeadline + 2 hours;

        vm.prank(curator);
        roundId = roundManager.createRound(conditionIds, commitDeadline, revealDeadline);
    }

    /// @dev Sets oracle payouts for all 5 markets: markets 1,2,3 = YES [1,0], markets 4,5 = NO [0,1].
    function _setDefaultPayouts() internal {
        uint256[] memory yes = new uint256[](2);
        yes[0] = 1;
        yes[1] = 0;

        uint256[] memory no = new uint256[](2);
        no[0] = 0;
        no[1] = 1;

        mockCtf.setPayouts(conditionIds[0], yes); // market1 YES
        mockCtf.setPayouts(conditionIds[1], yes); // market2 YES
        mockCtf.setPayouts(conditionIds[2], yes); // market3 YES
        mockCtf.setPayouts(conditionIds[3], no); // market4 NO
        mockCtf.setPayouts(conditionIds[4], no); // market5 NO
    }

    /// @dev Posts benchmark prices [5000, 7000, 3000, 8000, 6000].
    function _postDefaultBenchmarks(uint256 roundId) internal {
        uint16[] memory benchmarks = new uint16[](5);
        benchmarks[0] = 5000;
        benchmarks[1] = 7000;
        benchmarks[2] = 3000;
        benchmarks[3] = 8000;
        benchmarks[4] = 6000;

        vm.prank(curator);
        roundManager.postBenchmarkPrices(roundId, benchmarks);
    }

    /// @dev Computes expected Brier and Alpha scores for a given set of predictions and benchmarks
    ///      against the default payouts (markets 1-3 YES, markets 4-5 NO).
    function _computeExpectedScores(uint16[] memory predictions, uint16[] memory benchmarks, uint16 numScored)
        internal
        pure
        returns (uint256 expectedBrier, int256 expectedAlpha)
    {
        // outcomes: market1-3 = 10000 (YES), market4-5 = 0 (NO)
        int256[5] memory outcomes = [int256(10000), int256(10000), int256(10000), int256(0), int256(0)];

        uint256 totalBrier;
        int256 totalAlpha;

        for (uint256 i = 0; i < 5; i++) {
            int256 pred = int256(uint256(predictions[i]));
            int256 bench = int256(uint256(benchmarks[i]));
            int256 outcome = outcomes[i];

            int256 diff = pred - outcome;
            uint256 brierComponent = uint256(diff * diff);

            int256 benchDiff = bench - outcome;
            int256 baselineBrier = benchDiff * benchDiff;
            int256 alphaComponent = baselineBrier - int256(brierComponent);

            totalBrier += brierComponent;
            totalAlpha += alphaComponent;
        }

        expectedBrier = totalBrier / uint256(numScored);
        expectedAlpha = totalAlpha / int256(uint256(numScored));
    }

    function _verifyAgentScore(
        uint256 roundId,
        address agent,
        uint16[] memory preds,
        uint16 numScored,
        string memory label
    ) internal view {
        uint16[] memory benchmarks = new uint16[](5);
        benchmarks[0] = 5000;
        benchmarks[1] = 7000;
        benchmarks[2] = 3000;
        benchmarks[3] = 8000;
        benchmarks[4] = 6000;

        (uint256 expectedBrier, int256 expectedAlpha) = _computeExpectedScores(preds, benchmarks, numScored);
        IPredictionArena.Score memory s = arena.getScore(roundId, agent);
        assertEq(s.brierScore, expectedBrier, string.concat(label, " brierScore mismatch"));
        assertEq(s.alphaScore, expectedAlpha, string.concat(label, " alphaScore mismatch"));
        assertEq(s.scoredMarkets, numScored, string.concat(label, " scoredMarkets mismatch"));
    }

    function _claimAndVerifyRebate(address agent) internal {
        uint256 balBefore = agent.balance;
        vm.prank(agent);
        gasRebate.claimRebate();
        assertEq(agent.balance - balBefore, REBATE_PER_REVEAL);
        assertEq(gasRebate.getClaimable(agent), 0);
    }

    // ---------------------------------------------------------------
    // test_fullRound_happyPath
    // ---------------------------------------------------------------

    function test_fullRound_happyPath() public {
        // 1. Register 2 agents (agent3 participates without registration)
        vm.prank(agent1);
        registry.registerAgent("Agent Alpha", "https://alpha.ai", agent1);
        vm.prank(agent2);
        registry.registerAgent("Agent Beta", "https://beta.ai", agent2);

        assertTrue(registry.isRegistered(agent1));
        assertTrue(registry.isRegistered(agent2));
        assertFalse(registry.isRegistered(agent3));

        // 2. Curator creates round
        (uint256 roundId, uint64 commitDeadline, uint64 revealStart,) = _createDefaultRound();
        assertEq(roundId, 1);

        // 3. All 3 agents commit with different predictions
        // Agent1: good predictor — predicts close to outcomes (YES=10000, NO=0)
        uint16[] memory preds1 = new uint16[](5);
        preds1[0] = 9000; // market1 YES outcome=10000
        preds1[1] = 9500; // market2 YES
        preds1[2] = 8500; // market3 YES
        preds1[3] = 1000; // market4 NO outcome=0
        preds1[4] = 500; // market5 NO
        bytes32 salt1 = keccak256("salt1");

        // Agent2: bad predictor — predicts opposite of outcomes
        uint16[] memory preds2 = new uint16[](5);
        preds2[0] = 2000; // market1 YES but predicted low
        preds2[1] = 1500;
        preds2[2] = 1000;
        preds2[3] = 9000; // market4 NO but predicted high
        preds2[4] = 8500;
        bytes32 salt2 = keccak256("salt2");

        // Agent3: mid predictor — predicts around 5000 for all
        uint16[] memory preds3 = new uint16[](5);
        preds3[0] = 5000;
        preds3[1] = 5000;
        preds3[2] = 5000;
        preds3[3] = 5000;
        preds3[4] = 5000;
        bytes32 salt3 = keccak256("salt3");

        bytes32 hash1 = _computeCommitHash(roundId, preds1, salt1);
        bytes32 hash2 = _computeCommitHash(roundId, preds2, salt2);
        bytes32 hash3 = _computeCommitHash(roundId, preds3, salt3);

        vm.prank(agent1);
        arena.commit(roundId, hash1);
        vm.prank(agent2);
        arena.commit(roundId, hash2);
        vm.prank(agent3);
        arena.commit(roundId, hash3);

        assertEq(arena.getCommitCount(roundId), 3);
        assertTrue(arena.hasCommitted(roundId, agent1));
        assertTrue(arena.hasCommitted(roundId, agent2));
        assertTrue(arena.hasCommitted(roundId, agent3));

        // 4. Warp past commit deadline
        vm.warp(commitDeadline + 1);

        // 5. Curator posts benchmark prices
        _postDefaultBenchmarks(roundId);

        // 6. Set mock oracle payouts
        _setDefaultPayouts();

        // 7. Warp past revealStart
        vm.warp(revealStart + 1);

        // 8. All 3 agents reveal
        vm.prank(agent1);
        arena.reveal(roundId, preds1, salt1);
        vm.prank(agent2);
        arena.reveal(roundId, preds2, salt2);
        vm.prank(agent3);
        arena.reveal(roundId, preds3, salt3);

        assertTrue(arena.hasRevealed(roundId, agent1));
        assertTrue(arena.hasRevealed(roundId, agent2));
        assertTrue(arena.hasRevealed(roundId, agent3));

        // 9. Verify scores
        _verifyAgentScore(roundId, agent1, preds1, 5, "Agent1");
        _verifyAgentScore(roundId, agent2, preds2, 5, "Agent2");
        _verifyAgentScore(roundId, agent3, preds3, 5, "Agent3");

        // Agent1 (good) should have better (lower) brier than Agent2 (bad)
        assertTrue(
            arena.getScore(roundId, agent1).brierScore < arena.getScore(roundId, agent2).brierScore,
            "Good predictor should have lower brier"
        );
        assertTrue(
            arena.getScore(roundId, agent1).alphaScore > arena.getScore(roundId, agent2).alphaScore,
            "Good predictor should have higher alpha"
        );

        // 10. Verify gas rebates accrued (3 accruals)
        assertEq(gasRebate.getClaimable(agent1), REBATE_PER_REVEAL);
        assertEq(gasRebate.getClaimable(agent2), REBATE_PER_REVEAL);
        assertEq(gasRebate.getClaimable(agent3), REBATE_PER_REVEAL);
        assertEq(gasRebate.totalDistributed(), REBATE_PER_REVEAL * 3);

        // 11. Agents claim rebates — verify POL transfers
        _claimAndVerifyRebate(agent1);
        _claimAndVerifyRebate(agent2);
        _claimAndVerifyRebate(agent3);
    }

    // ---------------------------------------------------------------
    // test_fullRound_partialResolution
    // ---------------------------------------------------------------

    function test_fullRound_partialResolution() public {
        (uint256 roundId, uint64 commitDeadline, uint64 revealStart,) = _createDefaultRound();

        // Agent1 commits
        uint16[] memory preds = new uint16[](5);
        preds[0] = 9000;
        preds[1] = 8000;
        preds[2] = 7000;
        preds[3] = 2000;
        preds[4] = 3000;
        bytes32 salt = keccak256("partialSalt");
        bytes32 hash = _computeCommitHash(roundId, preds, salt);

        vm.prank(agent1);
        arena.commit(roundId, hash);

        // Warp past commit deadline, post benchmarks
        vm.warp(commitDeadline + 1);
        _postDefaultBenchmarks(roundId);

        // Only set payouts for 3 of 5 markets (markets 1, 2, 3)
        uint256[] memory yes = new uint256[](2);
        yes[0] = 1;
        yes[1] = 0;
        mockCtf.setPayouts(conditionIds[0], yes);
        mockCtf.setPayouts(conditionIds[1], yes);
        mockCtf.setPayouts(conditionIds[2], yes);
        // markets 4 and 5 left unresolved (payoutDenominator = 0)

        // Warp past revealStart and reveal
        vm.warp(revealStart + 1);
        vm.prank(agent1);
        arena.reveal(roundId, preds, salt);

        // Verify scoredMarkets = 3
        IPredictionArena.Score memory score = arena.getScore(roundId, agent1);
        assertEq(score.scoredMarkets, 3, "Should only score 3 resolved markets");
        assertEq(score.totalMarkets, 5, "Total markets should still be 5");

        // Manually compute expected scores for only markets 0, 1, 2 (all YES, outcome=10000)
        uint16[] memory benchmarks = new uint16[](5);
        benchmarks[0] = 5000;
        benchmarks[1] = 7000;
        benchmarks[2] = 3000;
        benchmarks[3] = 8000;
        benchmarks[4] = 6000;

        uint256 totalBrier;
        int256 totalAlpha;
        for (uint256 i = 0; i < 3; i++) {
            int256 pred = int256(uint256(preds[i]));
            int256 bench = int256(uint256(benchmarks[i]));
            int256 outcome = int256(10000);

            int256 diff = pred - outcome;
            uint256 brierComp = uint256(diff * diff);

            int256 benchDiff = bench - outcome;
            int256 baselineBrier = benchDiff * benchDiff;
            int256 alphaComp = baselineBrier - int256(brierComp);

            totalBrier += brierComp;
            totalAlpha += alphaComp;
        }

        assertEq(score.brierScore, totalBrier / 3, "Partial brier mismatch");
        assertEq(score.alphaScore, totalAlpha / 3, "Partial alpha mismatch");
    }

    // ---------------------------------------------------------------
    // test_fullRound_nonRevealer
    // ---------------------------------------------------------------

    function test_fullRound_nonRevealer() public {
        (uint256 roundId, uint64 commitDeadline, uint64 revealStart,) = _createDefaultRound();

        // All 3 agents commit
        uint16[] memory preds1 = new uint16[](5);
        preds1[0] = 9000;
        preds1[1] = 9500;
        preds1[2] = 8500;
        preds1[3] = 1000;
        preds1[4] = 500;
        bytes32 salt1 = keccak256("nr_salt1");

        uint16[] memory preds2 = new uint16[](5);
        preds2[0] = 7000;
        preds2[1] = 6000;
        preds2[2] = 8000;
        preds2[3] = 3000;
        preds2[4] = 2000;
        bytes32 salt2 = keccak256("nr_salt2");

        uint16[] memory preds3 = new uint16[](5);
        preds3[0] = 5000;
        preds3[1] = 5000;
        preds3[2] = 5000;
        preds3[3] = 5000;
        preds3[4] = 5000;
        bytes32 salt3 = keccak256("nr_salt3");

        vm.prank(agent1);
        arena.commit(roundId, _computeCommitHash(roundId, preds1, salt1));
        vm.prank(agent2);
        arena.commit(roundId, _computeCommitHash(roundId, preds2, salt2));
        vm.prank(agent3);
        arena.commit(roundId, _computeCommitHash(roundId, preds3, salt3));

        // Warp, post benchmarks, set payouts
        vm.warp(commitDeadline + 1);
        _postDefaultBenchmarks(roundId);
        _setDefaultPayouts();

        // Warp to reveal phase — only agent1 and agent2 reveal
        vm.warp(revealStart + 1);
        vm.prank(agent1);
        arena.reveal(roundId, preds1, salt1);
        vm.prank(agent2);
        arena.reveal(roundId, preds2, salt2);
        // agent3 does NOT reveal

        // Verify revealers have scores
        assertTrue(arena.hasRevealed(roundId, agent1));
        assertTrue(arena.hasRevealed(roundId, agent2));
        assertFalse(arena.hasRevealed(roundId, agent3));

        IPredictionArena.Score memory score1 = arena.getScore(roundId, agent1);
        IPredictionArena.Score memory score2 = arena.getScore(roundId, agent2);
        IPredictionArena.Score memory score3 = arena.getScore(roundId, agent3);

        assertEq(score1.scoredMarkets, 5, "Agent1 should be scored");
        assertEq(score2.scoredMarkets, 5, "Agent2 should be scored");

        // Non-revealer has no score
        assertEq(score3.scoredMarkets, 0, "Non-revealer should have 0 scoredMarkets");
        assertEq(score3.brierScore, 0, "Non-revealer should have 0 brierScore");
        assertEq(score3.alphaScore, 0, "Non-revealer should have 0 alphaScore");

        // Non-revealer has no rebate
        assertEq(gasRebate.getClaimable(agent3), 0, "Non-revealer should have no rebate");
        // Revealers do
        assertEq(gasRebate.getClaimable(agent1), REBATE_PER_REVEAL);
        assertEq(gasRebate.getClaimable(agent2), REBATE_PER_REVEAL);
    }

    // ---------------------------------------------------------------
    // test_fullRound_invalidatedMidway
    // ---------------------------------------------------------------

    function test_fullRound_invalidatedMidway() public {
        (uint256 roundId, uint64 commitDeadline, uint64 revealStart,) = _createDefaultRound();

        // Agents commit
        uint16[] memory preds = new uint16[](5);
        preds[0] = 5000;
        preds[1] = 5000;
        preds[2] = 5000;
        preds[3] = 5000;
        preds[4] = 5000;
        bytes32 salt = keccak256("inv_salt");

        vm.prank(agent1);
        arena.commit(roundId, _computeCommitHash(roundId, preds, salt));
        vm.prank(agent2);
        arena.commit(roundId, _computeCommitHash(roundId, preds, keccak256("inv_salt2")));

        // Admin invalidates round
        vm.prank(admin);
        roundManager.invalidateRound(roundId);

        // Warp past commit deadline, post benchmarks not possible but let's warp to reveal
        vm.warp(revealStart + 1);

        // Agent tries to reveal — should revert
        vm.prank(agent1);
        vm.expectRevert("Round invalidated");
        arena.reveal(roundId, preds, salt);

        // Also verify new commits fail
        vm.prank(agent3);
        vm.expectRevert("Round invalidated");
        arena.commit(roundId, _computeCommitHash(roundId, preds, keccak256("new_salt")));
    }

    // ---------------------------------------------------------------
    // test_multipleRounds
    // ---------------------------------------------------------------

    function test_multipleRounds() public {
        // --- Round 1 ---
        (uint256 roundId1, uint256 brier1_a1, uint256 brier1_a2, int256 alpha1_a1, int256 alpha1_a2) = _runRound1();

        // --- Round 2 ---
        uint256 roundId2 = _runRound2();

        // Verify round 1 scores unchanged after round 2
        assertEq(brier1_a1, arena.getScore(roundId1, agent1).brierScore, "Round 1 agent1 brier changed");
        assertEq(alpha1_a1, arena.getScore(roundId1, agent1).alphaScore, "Round 1 agent1 alpha changed");
        assertEq(brier1_a2, arena.getScore(roundId1, agent2).brierScore, "Round 1 agent2 brier changed");
        assertEq(alpha1_a2, arena.getScore(roundId1, agent2).alphaScore, "Round 1 agent2 alpha changed");

        // Verify round 2 scores differ from round 1
        assertTrue(
            brier1_a1 != arena.getScore(roundId2, agent1).brierScore
                || alpha1_a1 != arena.getScore(roundId2, agent1).alphaScore,
            "Agent1 scores should differ between rounds"
        );

        // All 4 reveals should have accrued rebates
        assertEq(gasRebate.totalDistributed(), REBATE_PER_REVEAL * 4);
        assertEq(gasRebate.getClaimable(agent1), REBATE_PER_REVEAL * 2);
        assertEq(gasRebate.getClaimable(agent2), REBATE_PER_REVEAL * 2);
    }

    function _runRound1()
        internal
        returns (uint256 roundId, uint256 brier_a1, uint256 brier_a2, int256 alpha_a1, int256 alpha_a2)
    {
        uint64 commitDeadline;
        uint64 revealStart;
        (roundId, commitDeadline, revealStart,) = _createDefaultRound();

        uint16[] memory preds1 = new uint16[](5);
        preds1[0] = 9000;
        preds1[1] = 9000;
        preds1[2] = 9000;
        preds1[3] = 1000;
        preds1[4] = 1000;
        bytes32 salt1 = keccak256("multi_r1_s1");

        uint16[] memory preds2 = new uint16[](5);
        preds2[0] = 5000;
        preds2[1] = 5000;
        preds2[2] = 5000;
        preds2[3] = 5000;
        preds2[4] = 5000;
        bytes32 salt2 = keccak256("multi_r1_s2");

        vm.prank(agent1);
        arena.commit(roundId, _computeCommitHash(roundId, preds1, salt1));
        vm.prank(agent2);
        arena.commit(roundId, _computeCommitHash(roundId, preds2, salt2));

        vm.warp(commitDeadline + 1);
        _postDefaultBenchmarks(roundId);
        _setDefaultPayouts();

        vm.warp(revealStart + 1);
        vm.prank(agent1);
        arena.reveal(roundId, preds1, salt1);
        vm.prank(agent2);
        arena.reveal(roundId, preds2, salt2);

        IPredictionArena.Score memory s1 = arena.getScore(roundId, agent1);
        IPredictionArena.Score memory s2 = arena.getScore(roundId, agent2);
        brier_a1 = s1.brierScore;
        alpha_a1 = s1.alphaScore;
        brier_a2 = s2.brierScore;
        alpha_a2 = s2.alphaScore;
    }

    function _runRound2() internal returns (uint256 roundId2) {
        // Clear old payouts
        for (uint256 i = 0; i < 5; i++) {
            mockCtf.clearPayouts(conditionIds[i]);
        }

        uint64 commitDeadline2 = uint64(block.timestamp) + 2 hours;
        uint64 revealDeadline2 = commitDeadline2 + 2 hours + 13 hours;
        uint64 revealStart2 = commitDeadline2 + 2 hours;

        vm.prank(curator);
        roundId2 = roundManager.createRound(conditionIds, commitDeadline2, revealDeadline2);

        uint16[] memory preds1 = new uint16[](5);
        preds1[0] = 3000;
        preds1[1] = 2000;
        preds1[2] = 4000;
        preds1[3] = 8000;
        preds1[4] = 7000;
        bytes32 salt1 = keccak256("multi_r2_s1");

        uint16[] memory preds2 = new uint16[](5);
        preds2[0] = 8000;
        preds2[1] = 7000;
        preds2[2] = 9000;
        preds2[3] = 2000;
        preds2[4] = 1000;
        bytes32 salt2 = keccak256("multi_r2_s2");

        vm.prank(agent1);
        arena.commit(roundId2, _computeCommitHash(roundId2, preds1, salt1));
        vm.prank(agent2);
        arena.commit(roundId2, _computeCommitHash(roundId2, preds2, salt2));

        vm.warp(commitDeadline2 + 1);

        uint16[] memory benchmarks2 = new uint16[](5);
        benchmarks2[0] = 6000;
        benchmarks2[1] = 4000;
        benchmarks2[2] = 5000;
        benchmarks2[3] = 7000;
        benchmarks2[4] = 3000;
        vm.prank(curator);
        roundManager.postBenchmarkPrices(roundId2, benchmarks2);

        uint256[] memory yes = new uint256[](2);
        yes[0] = 1;
        yes[1] = 0;
        for (uint256 i = 0; i < 5; i++) {
            mockCtf.setPayouts(conditionIds[i], yes);
        }

        vm.warp(revealStart2 + 1);
        vm.prank(agent1);
        arena.reveal(roundId2, preds1, salt1);
        vm.prank(agent2);
        arena.reveal(roundId2, preds2, salt2);
    }

    // ---------------------------------------------------------------
    // test_concurrentRounds
    // ---------------------------------------------------------------

    function test_concurrentRounds() public {
        // Create 2 rounds with overlapping commit windows
        uint64 commitDeadlineA = uint64(block.timestamp) + 3 hours;
        uint64 revealDeadlineA = commitDeadlineA + 2 hours + 13 hours;

        uint64 commitDeadlineB = uint64(block.timestamp) + 4 hours;
        uint64 revealDeadlineB = commitDeadlineB + 2 hours + 13 hours;

        vm.prank(curator);
        uint256 roundA = roundManager.createRound(conditionIds, commitDeadlineA, revealDeadlineA);
        vm.prank(curator);
        uint256 roundB = roundManager.createRound(conditionIds, commitDeadlineB, revealDeadlineB);

        assertEq(roundA, 1);
        assertEq(roundB, 2);

        // Agent1 commits to both rounds (different predictions)
        uint16[] memory predsA = new uint16[](5);
        predsA[0] = 9000;
        predsA[1] = 8000;
        predsA[2] = 7000;
        predsA[3] = 1000;
        predsA[4] = 2000;
        bytes32 saltA = keccak256("concA");

        uint16[] memory predsB = new uint16[](5);
        predsB[0] = 6000;
        predsB[1] = 5000;
        predsB[2] = 4000;
        predsB[3] = 3000;
        predsB[4] = 7000;
        bytes32 saltB = keccak256("concB");

        vm.prank(agent1);
        arena.commit(roundA, _computeCommitHash(roundA, predsA, saltA));
        vm.prank(agent1);
        arena.commit(roundB, _computeCommitHash(roundB, predsB, saltB));

        assertTrue(arena.hasCommitted(roundA, agent1));
        assertTrue(arena.hasCommitted(roundB, agent1));

        // Warp past both commit deadlines (B is later)
        vm.warp(commitDeadlineB + 1);

        // Post benchmarks for both rounds
        _postDefaultBenchmarks(roundA);

        uint16[] memory benchmarksB = new uint16[](5);
        benchmarksB[0] = 4000;
        benchmarksB[1] = 6000;
        benchmarksB[2] = 5000;
        benchmarksB[3] = 7000;
        benchmarksB[4] = 3000;
        vm.prank(curator);
        roundManager.postBenchmarkPrices(roundB, benchmarksB);

        // Set payouts
        _setDefaultPayouts();

        // Warp past both revealStarts (B's revealStart is later)
        uint64 revealStartB = commitDeadlineB + 2 hours;
        vm.warp(revealStartB + 1);

        // Agent reveals in both rounds
        vm.prank(agent1);
        arena.reveal(roundA, predsA, saltA);
        vm.prank(agent1);
        arena.reveal(roundB, predsB, saltB);

        // Verify independent scoring
        IPredictionArena.Score memory scoreA = arena.getScore(roundA, agent1);
        IPredictionArena.Score memory scoreB = arena.getScore(roundB, agent1);

        assertEq(scoreA.scoredMarkets, 5, "RoundA scoredMarkets");
        assertEq(scoreB.scoredMarkets, 5, "RoundB scoredMarkets");

        // Scores should differ because predictions and benchmarks differ
        assertTrue(
            scoreA.brierScore != scoreB.brierScore || scoreA.alphaScore != scoreB.alphaScore,
            "Scores should differ between concurrent rounds"
        );

        // Verify 2 rebate accruals
        assertEq(gasRebate.getClaimable(agent1), REBATE_PER_REVEAL * 2);
        assertEq(gasRebate.totalDistributed(), REBATE_PER_REVEAL * 2);

        // Verify revealed predictions stored independently
        uint16[] memory revealedA = arena.getRevealedPredictions(roundA, agent1);
        uint16[] memory revealedB = arena.getRevealedPredictions(roundB, agent1);
        assertEq(revealedA[0], 9000);
        assertEq(revealedB[0], 6000);
    }
}
