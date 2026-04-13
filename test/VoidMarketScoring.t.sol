// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {PredictionArena} from "../src/PredictionArena.sol";
import {IPredictionArena} from "../src/interfaces/IPredictionArena.sol";
import {RoundManager} from "../src/RoundManager.sol";
import {MockConditionalTokens} from "./mocks/MockConditionalTokens.sol";

/**
 * @dev Tests that void/split CTF market resolutions (non-binary payouts)
 *      are excluded from scoring but still count toward minResolvedMarkets.
 */
contract VoidMarketScoringTest is Test {
    PredictionArena public arena;
    RoundManager public roundManager;
    MockConditionalTokens public mockCtf;

    address admin = address(0xA);
    address curator = address(0xC);
    address agent1 = address(0x1);

    bytes32 cid0 = keccak256("market_0");
    bytes32 cid1 = keccak256("market_1");
    bytes32 cid2 = keccak256("market_2");

    event ScoreComputed(
        uint256 indexed roundId, address indexed agent, uint256 brierScore, int256 alphaScore, uint16 scoredMarkets
    );

    function setUp() public {
        vm.warp(1000000);
        mockCtf = new MockConditionalTokens();
        roundManager = new RoundManager(curator, admin);
        arena = new PredictionArena(address(roundManager), address(mockCtf), admin);
    }

    function _createRound() internal returns (uint256 roundId) {
        bytes32[] memory conditionIds = new bytes32[](3);
        conditionIds[0] = cid0;
        conditionIds[1] = cid1;
        conditionIds[2] = cid2;
        uint64 commitDeadline = uint64(block.timestamp) + 2 hours;
        uint64 revealStart = commitDeadline + 2 hours;
        uint64 revealDeadline = revealStart + 13 hours;
        vm.prank(curator);
        roundId = roundManager.createRound(conditionIds, commitDeadline, revealStart, revealDeadline, 2);
    }

    function _commitAndSetup(uint256 roundId, uint16[] memory preds, bytes32 salt) internal {
        // Compute commit hash with tight 2-byte packing
        bytes memory packed = abi.encodePacked(roundId);
        for (uint256 i = 0; i < preds.length; i++) {
            packed = abi.encodePacked(packed, preds[i]);
        }
        bytes32 commitHash = keccak256(abi.encodePacked(packed, salt));

        // Commit
        vm.prank(agent1);
        arena.commit(roundId, commitHash);

        // Warp past commit, post benchmarks
        vm.warp(block.timestamp + 2 hours + 1);
        uint16[] memory benchmarks = new uint16[](3);
        benchmarks[0] = 5000;
        benchmarks[1] = 5000;
        benchmarks[2] = 5000;
        vm.prank(curator);
        roundManager.postBenchmarkPrices(roundId, benchmarks);

        // Warp to reveal phase
        vm.warp(block.timestamp + 2 hours + 1);
    }

    /// @dev Void market (50/50 split) should be skipped from scoring
    ///      but still count toward minResolvedMarkets.
    function test_voidMarket_skippedFromScoring() public {
        uint256 roundId = _createRound();

        uint16[] memory preds = new uint16[](3);
        preds[0] = 8000; // market 0: will be YES
        preds[1] = 5000; // market 1: will be void (50/50)
        preds[2] = 2000; // market 2: will be NO
        bytes32 salt = keccak256("void_test");

        _commitAndSetup(roundId, preds, salt);

        // market 0: YES (payout0=1, payout1=0, denom=1)
        uint256[] memory yes = new uint256[](2);
        yes[0] = 1;
        yes[1] = 0;
        mockCtf.setPayouts(cid0, yes);

        // market 1: VOID (payout0=1, payout1=1, denom=2)
        uint256[] memory void_ = new uint256[](2);
        void_[0] = 1;
        void_[1] = 1;
        mockCtf.setPayouts(cid1, void_);

        // market 2: NO (payout0=0, payout1=1, denom=1)
        uint256[] memory no = new uint256[](2);
        no[0] = 0;
        no[1] = 1;
        mockCtf.setPayouts(cid2, no);

        // All 3 markets are resolved (denom > 0), minResolvedMarkets=2 is satisfied.
        // But only 2 should be scored (void market excluded).
        vm.prank(agent1);
        arena.reveal(roundId, preds, salt);

        IPredictionArena.Score memory score = arena.getScore(roundId, agent1);
        // Should score only markets 0 and 2 (not the void market 1)
        assertEq(score.scoredMarkets, 2, "Void market should be excluded from scoring");

        // Verify the actual scores make sense:
        // Market 0: pred=8000, outcome=10000 (YES), diff=-2000, brier=4000000
        // Market 2: pred=2000, outcome=0 (NO), diff=2000, brier=4000000
        // Average brier = (4000000 + 4000000) / 2 = 4000000
        assertEq(score.brierScore, 4000000, "Brier score should only include binary markets");
    }

    /// @dev Void markets still count toward minResolvedMarkets.
    ///      With 2 binary + 1 void resolved, minResolvedMarkets=3 should pass.
    function test_voidMarket_countsTowardMinResolved() public {
        // Create round with minResolvedMarkets=3
        bytes32[] memory conditionIds = new bytes32[](3);
        conditionIds[0] = cid0;
        conditionIds[1] = cid1;
        conditionIds[2] = cid2;
        vm.prank(curator);
        uint256 roundId = roundManager.createRound(
            conditionIds,
            uint64(block.timestamp) + 2 hours,
            uint64(block.timestamp) + 4 hours,
            uint64(block.timestamp) + 17 hours,
            3 // all 3 must be resolved
        );

        uint16[] memory preds = new uint16[](3);
        preds[0] = 8000;
        preds[1] = 5000;
        preds[2] = 2000;
        bytes32 salt = keccak256("min_resolved_test");

        // Commit
        bytes memory packed = abi.encodePacked(roundId);
        for (uint256 i = 0; i < preds.length; i++) {
            packed = abi.encodePacked(packed, preds[i]);
        }
        vm.prank(agent1);
        arena.commit(roundId, keccak256(abi.encodePacked(packed, salt)));

        // Benchmarks + warp
        vm.warp(block.timestamp + 2 hours + 1);
        uint16[] memory benchmarks = new uint16[](3);
        benchmarks[0] = 5000;
        benchmarks[1] = 5000;
        benchmarks[2] = 5000;
        vm.prank(curator);
        roundManager.postBenchmarkPrices(roundId, benchmarks);
        vm.warp(block.timestamp + 2 hours + 1);

        // 2 binary + 1 void = 3 resolved
        uint256[] memory yes = new uint256[](2);
        yes[0] = 1;
        yes[1] = 0;
        mockCtf.setPayouts(cid0, yes);

        uint256[] memory void_ = new uint256[](2);
        void_[0] = 1;
        void_[1] = 1;
        mockCtf.setPayouts(cid1, void_);

        uint256[] memory no = new uint256[](2);
        no[0] = 0;
        no[1] = 1;
        mockCtf.setPayouts(cid2, no);

        // Should not revert — all 3 are resolved (void counts)
        vm.prank(agent1);
        arena.reveal(roundId, preds, salt);

        IPredictionArena.Score memory score = arena.getScore(roundId, agent1);
        assertEq(score.scoredMarkets, 2, "Only binary markets scored");
    }

    /// @dev If only void markets are resolved and no binary ones,
    ///      scoring should still work (scoredMarkets=0, scores=0).
    function test_allVoidMarkets_zeroScore() public {
        // Create round with minResolvedMarkets=1
        bytes32[] memory conditionIds = new bytes32[](2);
        conditionIds[0] = cid0;
        conditionIds[1] = cid1;
        vm.prank(curator);
        uint256 roundId = roundManager.createRound(
            conditionIds,
            uint64(block.timestamp) + 2 hours,
            uint64(block.timestamp) + 4 hours,
            uint64(block.timestamp) + 17 hours,
            1
        );

        uint16[] memory preds = new uint16[](2);
        preds[0] = 5000;
        preds[1] = 5000;
        bytes32 salt = keccak256("all_void");

        bytes memory packed = abi.encodePacked(roundId);
        for (uint256 i = 0; i < preds.length; i++) {
            packed = abi.encodePacked(packed, preds[i]);
        }
        vm.prank(agent1);
        arena.commit(roundId, keccak256(abi.encodePacked(packed, salt)));

        vm.warp(block.timestamp + 2 hours + 1);
        uint16[] memory benchmarks = new uint16[](2);
        benchmarks[0] = 5000;
        benchmarks[1] = 5000;
        vm.prank(curator);
        roundManager.postBenchmarkPrices(roundId, benchmarks);
        vm.warp(block.timestamp + 2 hours + 1);

        // Both void
        uint256[] memory void_ = new uint256[](2);
        void_[0] = 1;
        void_[1] = 1;
        mockCtf.setPayouts(cid0, void_);
        mockCtf.setPayouts(cid1, void_);

        vm.prank(agent1);
        arena.reveal(roundId, preds, salt);

        IPredictionArena.Score memory score = arena.getScore(roundId, agent1);
        assertEq(score.scoredMarkets, 0, "No binary markets to score");
        assertEq(score.brierScore, 0);
    }
}
