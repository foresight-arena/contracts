// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IRoundManager} from "./interfaces/IRoundManager.sol";

contract RoundManager is IRoundManager {
    uint64 public constant MIN_COMMIT_WINDOW = 1 hours;
    uint64 public constant MIN_REVEAL_WINDOW = 12 hours;

    mapping(uint256 => Round) internal _rounds;
    uint256 public currentRoundId;
    address public curator;
    address public admin;

    modifier onlyCurator() {
        require(msg.sender == curator, "Only curator");
        _;
    }

    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin");
        _;
    }

    constructor(address _curator, address _admin) {
        require(_curator != address(0), "Invalid curator");
        require(_admin != address(0), "Invalid admin");
        curator = _curator;
        admin = _admin;
    }

    function createRound(
        bytes32[] calldata conditionIds,
        uint64 commitDeadline,
        uint64 revealStart,
        uint64 revealDeadline,
        uint16 minResolvedMarkets
    ) external virtual onlyCurator returns (uint256 roundId) {
        require(conditionIds.length >= 1 && conditionIds.length <= 20, "Invalid market count");
        require(commitDeadline > uint64(block.timestamp) + MIN_COMMIT_WINDOW, "Commit deadline too soon");
        require(revealStart > commitDeadline, "Reveal start must be after commit deadline");
        require(revealDeadline > revealStart + MIN_REVEAL_WINDOW, "Reveal deadline too soon");
        require(minResolvedMarkets <= conditionIds.length, "Min resolved exceeds market count");

        roundId = ++currentRoundId;
        Round storage r = _rounds[roundId];
        r.conditionIds = conditionIds;
        r.commitDeadline = commitDeadline;
        r.revealStart = revealStart;
        r.revealDeadline = revealDeadline;
        r.minResolvedMarkets = minResolvedMarkets;

        emit RoundCreated(roundId, conditionIds, commitDeadline, revealStart, revealDeadline, minResolvedMarkets);
    }

    function postBenchmarkPrices(uint256 roundId, uint16[] calldata benchmarkPrices) external onlyCurator {
        Round storage r = _rounds[roundId];
        require(r.conditionIds.length > 0, "Round does not exist");
        require(uint64(block.timestamp) >= r.commitDeadline, "Commit phase not ended");
        require(!r.benchmarksPosted, "Benchmarks already posted");
        require(benchmarkPrices.length == r.conditionIds.length, "Length mismatch");

        for (uint256 i = 0; i < benchmarkPrices.length; i++) {
            require(benchmarkPrices[i] <= 10000, "Price out of range");
        }

        r.benchmarkPrices = benchmarkPrices;
        r.benchmarksPosted = true;

        emit BenchmarksPosted(roundId, benchmarkPrices);
    }

    function invalidateRound(uint256 roundId) external onlyAdmin {
        Round storage r = _rounds[roundId];
        require(r.conditionIds.length > 0, "Round does not exist");
        r.invalidated = true;

        emit RoundInvalidated(roundId);
    }

    function setCurator(address newCurator) external onlyAdmin {
        require(newCurator != address(0), "Invalid curator");
        address old = curator;
        curator = newCurator;
        emit CuratorChanged(old, newCurator);
    }

    function setAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "Invalid admin");
        admin = newAdmin;
    }

    function getRound(uint256 roundId) external view returns (Round memory) {
        return _rounds[roundId];
    }

    function getMarketCount(uint256 roundId) external view returns (uint256) {
        return _rounds[roundId].conditionIds.length;
    }

    function isCommitPhase(uint256 roundId) external view returns (bool) {
        Round storage r = _rounds[roundId];
        return r.conditionIds.length > 0 && !r.invalidated && uint64(block.timestamp) < r.commitDeadline;
    }

    function isRevealPhase(uint256 roundId) external view returns (bool) {
        Round storage r = _rounds[roundId];
        return r.conditionIds.length > 0 && !r.invalidated && uint64(block.timestamp) >= r.revealStart
            && uint64(block.timestamp) < r.revealDeadline;
    }
}
