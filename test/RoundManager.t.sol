// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {RoundManager} from "../src/RoundManager.sol";
import {IRoundManager} from "../src/interfaces/IRoundManager.sol";

contract RoundManagerTest is Test {
    RoundManager public rm;

    address curator = address(0xC0);
    address admin = address(0xAD);
    address alice = address(0xA1);

    uint64 constant MIN_COMMIT_WINDOW = 1 hours;
    uint64 constant REVEAL_START_BUFFER = 2 hours;
    uint64 constant MIN_REVEAL_WINDOW = 12 hours;

    event RoundCreated(
        uint256 indexed roundId,
        bytes32[] conditionIds,
        uint64 commitDeadline,
        uint64 revealStart,
        uint64 revealDeadline,
        uint16 minResolvedMarkets
    );
    event BenchmarksPosted(uint256 indexed roundId, uint16[] benchmarkPrices);
    event RoundInvalidated(uint256 indexed roundId);
    event CuratorChanged(address indexed oldCurator, address indexed newCurator);

    function setUp() public {
        rm = new RoundManager(curator, admin);
        vm.warp(1000);
    }

    // ---------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------

    function _conditionIds(uint256 n) internal pure returns (bytes32[] memory ids) {
        ids = new bytes32[](n);
        for (uint256 i = 0; i < n; i++) {
            ids[i] = bytes32(i + 1);
        }
    }

    function _validCommitDeadline() internal view returns (uint64) {
        return uint64(block.timestamp) + MIN_COMMIT_WINDOW + 1;
    }

    function _validRevealStart(uint64 commitDeadline) internal pure returns (uint64) {
        return commitDeadline + REVEAL_START_BUFFER;
    }

    function _validRevealDeadline(uint64 revealStart) internal pure returns (uint64) {
        return revealStart + MIN_REVEAL_WINDOW + 1;
    }

    function _createDefaultRound() internal returns (uint256 roundId) {
        uint64 commit = _validCommitDeadline();
        uint64 rStart = _validRevealStart(commit);
        uint64 reveal = _validRevealDeadline(rStart);
        vm.prank(curator);
        roundId = rm.createRound(_conditionIds(3), commit, rStart, reveal, 1);
    }

    // ---------------------------------------------------------------
    // createRound
    // ---------------------------------------------------------------

    function test_createRound_success() public {
        bytes32[] memory ids = _conditionIds(3);
        uint64 commit = _validCommitDeadline();
        uint64 rStart = _validRevealStart(commit);
        uint64 reveal = _validRevealDeadline(rStart);

        vm.expectEmit(true, false, false, true);
        emit RoundCreated(1, ids, commit, rStart, reveal, 1);

        vm.prank(curator);
        uint256 roundId = rm.createRound(ids, commit, rStart, reveal, 1);

        assertEq(roundId, 1);
        assertEq(rm.currentRoundId(), 1);

        IRoundManager.Round memory r = rm.getRound(roundId);
        assertEq(r.conditionIds.length, 3);
        assertEq(r.conditionIds[0], ids[0]);
        assertEq(r.commitDeadline, commit);
        assertEq(r.revealStart, rStart);
        assertEq(r.revealDeadline, reveal);
        assertFalse(r.benchmarksPosted);
        assertFalse(r.invalidated);
    }

    function test_createRound_onlyCurator() public {
        uint64 commit = _validCommitDeadline();
        uint64 rStart = _validRevealStart(commit);
        uint64 reveal = _validRevealDeadline(rStart);

        vm.prank(alice);
        vm.expectRevert("Only curator");
        rm.createRound(_conditionIds(3), commit, rStart, reveal, 1);
    }

    function test_createRound_emptyMarkets() public {
        uint64 commit = _validCommitDeadline();
        uint64 rStart = _validRevealStart(commit);
        uint64 reveal = _validRevealDeadline(rStart);
        bytes32[] memory empty = new bytes32[](0);

        vm.prank(curator);
        vm.expectRevert("Invalid market count");
        rm.createRound(empty, commit, rStart, reveal, 1);
    }

    function test_createRound_tooManyMarkets() public {
        uint64 commit = _validCommitDeadline();
        uint64 rStart = _validRevealStart(commit);
        uint64 reveal = _validRevealDeadline(rStart);

        vm.prank(curator);
        vm.expectRevert("Invalid market count");
        rm.createRound(_conditionIds(21), commit, rStart, reveal, 1);
    }

    function test_createRound_commitDeadlineTooSoon() public {
        // commitDeadline <= block.timestamp + MIN_COMMIT_WINDOW
        uint64 commit = uint64(block.timestamp) + MIN_COMMIT_WINDOW; // exactly at boundary, not >
        uint64 rStart = _validRevealStart(commit);
        uint64 reveal = _validRevealDeadline(rStart);

        vm.prank(curator);
        vm.expectRevert("Commit deadline too soon");
        rm.createRound(_conditionIds(3), commit, rStart, reveal, 1);
    }

    function test_createRound_revealDeadlineTooSoon() public {
        uint64 commit = _validCommitDeadline();
        uint64 rStart = _validRevealStart(commit);
        // revealDeadline <= revealStart + MIN_REVEAL_WINDOW
        uint64 reveal = rStart + MIN_REVEAL_WINDOW; // exactly at boundary, not >

        vm.prank(curator);
        vm.expectRevert("Reveal deadline too soon");
        rm.createRound(_conditionIds(3), commit, rStart, reveal, 1);
    }

    function test_createRound_multipleRounds() public {
        uint256 r1 = _createDefaultRound();
        uint256 r2 = _createDefaultRound();
        uint256 r3 = _createDefaultRound();

        assertEq(r1, 1);
        assertEq(r2, 2);
        assertEq(r3, 3);
        assertEq(rm.currentRoundId(), 3);

        // Verify independent storage
        assertEq(rm.getMarketCount(r1), 3);
        assertEq(rm.getMarketCount(r2), 3);
        assertEq(rm.getMarketCount(r3), 3);

        IRoundManager.Round memory round1 = rm.getRound(r1);
        IRoundManager.Round memory round2 = rm.getRound(r2);
        assertEq(round1.commitDeadline, round2.commitDeadline);
    }

    // ---------------------------------------------------------------
    // postBenchmarkPrices
    // ---------------------------------------------------------------

    function test_postBenchmarks_success() public {
        uint256 roundId = _createDefaultRound();
        IRoundManager.Round memory r = rm.getRound(roundId);

        // Warp past commit deadline
        vm.warp(r.commitDeadline);

        uint16[] memory prices = new uint16[](3);
        prices[0] = 5000;
        prices[1] = 7500;
        prices[2] = 10000;

        vm.expectEmit(true, false, false, true);
        emit BenchmarksPosted(roundId, prices);

        vm.prank(curator);
        rm.postBenchmarkPrices(roundId, prices);

        IRoundManager.Round memory updated = rm.getRound(roundId);
        assertTrue(updated.benchmarksPosted);
        assertEq(updated.benchmarkPrices.length, 3);
        assertEq(updated.benchmarkPrices[0], 5000);
        assertEq(updated.benchmarkPrices[1], 7500);
        assertEq(updated.benchmarkPrices[2], 10000);
    }

    function test_postBenchmarks_onlyCurator() public {
        uint256 roundId = _createDefaultRound();
        IRoundManager.Round memory r = rm.getRound(roundId);
        vm.warp(r.commitDeadline);

        uint16[] memory prices = new uint16[](3);
        prices[0] = 5000;
        prices[1] = 5000;
        prices[2] = 5000;

        vm.prank(alice);
        vm.expectRevert("Only curator");
        rm.postBenchmarkPrices(roundId, prices);
    }

    function test_postBenchmarks_beforeCommitDeadline() public {
        uint256 roundId = _createDefaultRound();
        IRoundManager.Round memory r = rm.getRound(roundId);

        // Still before commit deadline
        vm.warp(r.commitDeadline - 1);

        uint16[] memory prices = new uint16[](3);
        prices[0] = 5000;
        prices[1] = 5000;
        prices[2] = 5000;

        vm.prank(curator);
        vm.expectRevert("Commit phase not ended");
        rm.postBenchmarkPrices(roundId, prices);
    }

    function test_postBenchmarks_wrongLength() public {
        uint256 roundId = _createDefaultRound();
        IRoundManager.Round memory r = rm.getRound(roundId);
        vm.warp(r.commitDeadline);

        uint16[] memory prices = new uint16[](2); // round has 3 markets
        prices[0] = 5000;
        prices[1] = 5000;

        vm.prank(curator);
        vm.expectRevert("Length mismatch");
        rm.postBenchmarkPrices(roundId, prices);
    }

    function test_postBenchmarks_priceOutOfRange() public {
        uint256 roundId = _createDefaultRound();
        IRoundManager.Round memory r = rm.getRound(roundId);
        vm.warp(r.commitDeadline);

        uint16[] memory prices = new uint16[](3);
        prices[0] = 5000;
        prices[1] = 10001; // > 10000
        prices[2] = 5000;

        vm.prank(curator);
        vm.expectRevert("Price out of range");
        rm.postBenchmarkPrices(roundId, prices);
    }

    function test_postBenchmarks_alreadyPosted() public {
        uint256 roundId = _createDefaultRound();
        IRoundManager.Round memory r = rm.getRound(roundId);
        vm.warp(r.commitDeadline);

        uint16[] memory prices = new uint16[](3);
        prices[0] = 5000;
        prices[1] = 5000;
        prices[2] = 5000;

        vm.prank(curator);
        rm.postBenchmarkPrices(roundId, prices);

        vm.prank(curator);
        vm.expectRevert("Benchmarks already posted");
        rm.postBenchmarkPrices(roundId, prices);
    }

    // ---------------------------------------------------------------
    // invalidateRound
    // ---------------------------------------------------------------

    function test_invalidateRound_success() public {
        uint256 roundId = _createDefaultRound();

        vm.expectEmit(true, false, false, true);
        emit RoundInvalidated(roundId);

        vm.prank(admin);
        rm.invalidateRound(roundId);

        IRoundManager.Round memory r = rm.getRound(roundId);
        assertTrue(r.invalidated);
    }

    function test_invalidateRound_onlyAdmin() public {
        uint256 roundId = _createDefaultRound();

        vm.prank(alice);
        vm.expectRevert("Only admin");
        rm.invalidateRound(roundId);
    }

    function test_invalidateRound_nonexistent() public {
        vm.prank(admin);
        vm.expectRevert("Round does not exist");
        rm.invalidateRound(999);
    }

    // ---------------------------------------------------------------
    // isCommitPhase
    // ---------------------------------------------------------------

    function test_isCommitPhase_beforeDeadline() public {
        uint256 roundId = _createDefaultRound();
        IRoundManager.Round memory r = rm.getRound(roundId);

        // Warp to just before commit deadline
        vm.warp(r.commitDeadline - 1);
        assertTrue(rm.isCommitPhase(roundId));
    }

    function test_isCommitPhase_afterDeadline() public {
        uint256 roundId = _createDefaultRound();
        IRoundManager.Round memory r = rm.getRound(roundId);

        // Warp to commit deadline (no longer < commitDeadline)
        vm.warp(r.commitDeadline);
        assertFalse(rm.isCommitPhase(roundId));

        // Warp past commit deadline
        vm.warp(r.commitDeadline + 1);
        assertFalse(rm.isCommitPhase(roundId));
    }

    // ---------------------------------------------------------------
    // isRevealPhase
    // ---------------------------------------------------------------

    function test_isRevealPhase_duringWindow() public {
        uint256 roundId = _createDefaultRound();
        IRoundManager.Round memory r = rm.getRound(roundId);

        // Warp to exactly revealStart
        vm.warp(r.revealStart);
        assertTrue(rm.isRevealPhase(roundId));

        // Warp to middle of reveal window
        vm.warp(r.revealStart + (r.revealDeadline - r.revealStart) / 2);
        assertTrue(rm.isRevealPhase(roundId));

        // Warp to just before revealDeadline
        vm.warp(r.revealDeadline - 1);
        assertTrue(rm.isRevealPhase(roundId));
    }

    function test_isRevealPhase_beforeStart() public {
        uint256 roundId = _createDefaultRound();
        IRoundManager.Round memory r = rm.getRound(roundId);

        // Warp to just before revealStart
        vm.warp(r.revealStart - 1);
        assertFalse(rm.isRevealPhase(roundId));
    }

    function test_isRevealPhase_afterDeadline() public {
        uint256 roundId = _createDefaultRound();
        IRoundManager.Round memory r = rm.getRound(roundId);

        // Warp to exactly revealDeadline (no longer < revealDeadline)
        vm.warp(r.revealDeadline);
        assertFalse(rm.isRevealPhase(roundId));

        // Warp past revealDeadline
        vm.warp(r.revealDeadline + 1);
        assertFalse(rm.isRevealPhase(roundId));
    }

    // ---------------------------------------------------------------
    // setCurator / setAdmin
    // ---------------------------------------------------------------

    function test_setCurator() public {
        address newCurator = address(0xC1);

        vm.expectEmit(true, true, false, true);
        emit CuratorChanged(curator, newCurator);

        vm.prank(admin);
        rm.setCurator(newCurator);

        assertEq(rm.curator(), newCurator);

        // Verify new curator can create rounds
        uint64 commit = _validCommitDeadline();
        uint64 rStart = _validRevealStart(commit);
        uint64 reveal = _validRevealDeadline(rStart);
        vm.prank(newCurator);
        uint256 roundId = rm.createRound(_conditionIds(2), commit, rStart, reveal, 1);
        assertEq(roundId, 1);

        // Verify old curator cannot
        vm.prank(curator);
        vm.expectRevert("Only curator");
        rm.createRound(_conditionIds(2), commit, rStart, reveal, 1);
    }

    function test_setAdmin() public {
        address newAdmin = address(0xAD2);

        vm.prank(admin);
        rm.setAdmin(newAdmin);

        assertEq(rm.admin(), newAdmin);

        // Verify new admin can invalidate
        uint256 roundId = _createDefaultRound();
        vm.prank(newAdmin);
        rm.invalidateRound(roundId);

        IRoundManager.Round memory r = rm.getRound(roundId);
        assertTrue(r.invalidated);

        // Verify old admin cannot
        uint256 roundId2 = _createDefaultRound();
        vm.prank(admin);
        vm.expectRevert("Only admin");
        rm.invalidateRound(roundId2);
    }

    function test_setCurator_onlyAdmin() public {
        vm.prank(alice);
        vm.expectRevert("Only admin");
        rm.setCurator(address(0xC1));
    }
}
