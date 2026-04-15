// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IPredictionArena {
    struct Commitment {
        bytes32 commitHash;
        bool revealed;
    }

    struct Score {
        uint256 brierScore;
        int256 alphaScore;
        uint16 scoredMarkets;
        uint16 totalMarkets;
    }

    event Committed(uint256 indexed roundId, address indexed agent, bytes32 commitHash, uint256 nonce);
    event Revealed(
        uint256 indexed roundId, address indexed agent, uint16[] predictions, uint16 scoredMarkets, uint256 nonce
    );
    event ScoreComputed(
        uint256 indexed roundId, address indexed agent, uint256 brierScore, int256 alphaScore, uint16 scoredMarkets
    );
    event OutcomesTriggered(uint256 indexed roundId, uint256 resolvedBitmask, uint16 resolvedCount);
    event PendingScoresProcessed(uint256 indexed roundId, uint256 processed, uint256 remaining);

    function commit(uint256 roundId, bytes32 commitHash) external;
    function reveal(uint256 roundId, uint16[] calldata predictions, bytes32 salt) external;

    function commitWithSignature(
        uint256 roundId,
        bytes32 commitHash,
        address agent,
        uint256 deadline,
        bytes calldata signature
    ) external;

    function revealWithSignature(
        uint256 roundId,
        uint16[] calldata predictions,
        bytes32 salt,
        address agent,
        uint256 deadline,
        bytes calldata signature
    ) external;

    function nonces(address agent) external view returns (uint256);

    function getCommitment(uint256 roundId, address agent) external view returns (Commitment memory);
    function getRevealedPredictions(uint256 roundId, address agent) external view returns (uint16[] memory);
    function getScore(uint256 roundId, address agent) external view returns (Score memory);
    function getCommitCount(uint256 roundId) external view returns (uint256);
    function hasCommitted(uint256 roundId, address agent) external view returns (bool);
    function hasRevealed(uint256 roundId, address agent) external view returns (bool);

    function triggerOutcomes(uint256 roundId) external;
    function triggerOutcomesAndScore(uint256 roundId) external;
    function calculateScoresForPendingReveals(uint256 roundId) external;
    function getRoundOutcomes(uint256 roundId)
        external
        view
        returns (bool triggered, uint256 bitmask, int256[] memory outcomes);
    function getPendingScoringCount(uint256 roundId) external view returns (uint256);
}
