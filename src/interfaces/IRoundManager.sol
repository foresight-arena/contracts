// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IRoundManager {
    struct Round {
        bytes32[] conditionIds;
        uint16[] benchmarkPrices;
        uint64 commitDeadline;
        uint64 revealStart;
        uint64 revealDeadline;
        uint16 minResolvedMarkets;
        bool benchmarksPosted;
        bool invalidated;
    }

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

    function createRound(
        bytes32[] calldata conditionIds,
        uint64 commitDeadline,
        uint64 revealStart,
        uint64 revealDeadline,
        uint16 minResolvedMarkets
    ) external returns (uint256 roundId);

    function postBenchmarkPrices(uint256 roundId, uint16[] calldata benchmarkPrices) external;
    function invalidateRound(uint256 roundId) external;
    function setCurator(address newCurator) external;
    function setAdmin(address newAdmin) external;

    function getRound(uint256 roundId) external view returns (Round memory);
    function getMarketCount(uint256 roundId) external view returns (uint256);
    function isCommitPhase(uint256 roundId) external view returns (bool);
    function isRevealPhase(uint256 roundId) external view returns (bool);
}
