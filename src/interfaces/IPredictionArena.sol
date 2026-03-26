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

    event Committed(uint256 indexed roundId, address indexed agent, bytes32 commitHash);
    event Revealed(uint256 indexed roundId, address indexed agent, uint16[] predictions, uint16 scoredMarkets);
    event ScoreComputed(
        uint256 indexed roundId, address indexed agent, uint256 brierScore, int256 alphaScore, uint16 scoredMarkets
    );

    function commit(uint256 roundId, bytes32 commitHash) external;
    function reveal(uint256 roundId, uint16[] calldata predictions, bytes32 salt) external;

    function getCommitment(uint256 roundId, address agent) external view returns (Commitment memory);
    function getRevealedPredictions(uint256 roundId, address agent) external view returns (uint16[] memory);
    function getScore(uint256 roundId, address agent) external view returns (Score memory);
    function getCommitCount(uint256 roundId) external view returns (uint256);
    function hasCommitted(uint256 roundId, address agent) external view returns (bool);
    function hasRevealed(uint256 roundId, address agent) external view returns (bool);
}
