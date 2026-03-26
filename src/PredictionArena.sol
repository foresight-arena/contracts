// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IPredictionArena} from "./interfaces/IPredictionArena.sol";
import {IRoundManager} from "./interfaces/IRoundManager.sol";
import {IConditionalTokens} from "./interfaces/IConditionalTokens.sol";
import {IGasRebate} from "./interfaces/IGasRebate.sol";

contract PredictionArena is IPredictionArena {
    IRoundManager public roundManager;
    IConditionalTokens public ctf;
    IGasRebate public gasRebate;
    address public admin;

    mapping(uint256 => mapping(address => Commitment)) internal _commitments;
    mapping(uint256 => mapping(address => uint16[])) internal _revealedPredictions;
    mapping(uint256 => mapping(address => Score)) internal _scores;
    mapping(uint256 => uint256) public commitCount;

    constructor(address _roundManager, address _ctf, address _gasRebate, address _admin) {
        require(_roundManager != address(0), "Invalid RoundManager");
        require(_ctf != address(0), "Invalid CTF");
        require(_admin != address(0), "Invalid admin");
        roundManager = IRoundManager(_roundManager);
        ctf = IConditionalTokens(_ctf);
        if (_gasRebate != address(0)) {
            gasRebate = IGasRebate(_gasRebate);
        }
        admin = _admin;
    }

    function setGasRebate(address _gasRebate) external {
        require(msg.sender == admin, "Only admin");
        gasRebate = IGasRebate(_gasRebate);
    }

    function commit(uint256 roundId, bytes32 commitHash) external {
        require(commitHash != bytes32(0), "Empty hash");

        IRoundManager.Round memory r = roundManager.getRound(roundId);
        require(r.conditionIds.length > 0, "Round does not exist");
        require(!r.invalidated, "Round invalidated");
        require(uint64(block.timestamp) < r.commitDeadline, "Commit phase ended");

        Commitment storage c = _commitments[roundId][msg.sender];
        require(c.commitHash == bytes32(0), "Already committed");

        c.commitHash = commitHash;
        commitCount[roundId]++;

        emit Committed(roundId, msg.sender, commitHash);
    }

    function reveal(uint256 roundId, uint16[] calldata predictions, bytes32 salt) external {
        IRoundManager.Round memory r = roundManager.getRound(roundId);
        require(r.conditionIds.length > 0, "Round does not exist");
        require(!r.invalidated, "Round invalidated");
        require(uint64(block.timestamp) >= r.revealStart, "Reveal not started");
        require(uint64(block.timestamp) < r.revealDeadline, "Reveal phase ended");
        require(r.benchmarksPosted, "Benchmarks not posted");

        Commitment storage c = _commitments[roundId][msg.sender];
        require(c.commitHash != bytes32(0), "No commitment");
        require(!c.revealed, "Already revealed");
        require(predictions.length == r.conditionIds.length, "Wrong prediction count");

        // Verify hash
        bytes32 expectedHash = keccak256(abi.encodePacked(roundId, predictions, salt));
        require(expectedHash == c.commitHash, "Hash mismatch");

        // Validate predictions
        for (uint256 i = 0; i < predictions.length; i++) {
            require(predictions[i] <= 10000, "Prediction out of range");
        }

        c.revealed = true;
        _revealedPredictions[roundId][msg.sender] = predictions;

        // Compute scores
        uint256 totalBrier;
        int256 totalAlpha;
        uint16 scoredMarkets;

        for (uint256 i = 0; i < r.conditionIds.length; i++) {
            bytes32 conditionId = r.conditionIds[i];

            // Check if resolved
            uint256 denom = ctf.payoutDenominator(conditionId);
            if (denom == 0) continue;

            uint256 payout0 = ctf.payoutNumerators(conditionId, 0);
            // outcome: 10000 if YES won, 0 if NO won
            int256 outcome = (payout0 > 0) ? int256(10000) : int256(0);
            int256 prediction = int256(uint256(predictions[i]));
            int256 benchmark = int256(uint256(r.benchmarkPrices[i]));

            int256 diff = prediction - outcome;
            uint256 brierComponent = uint256(diff * diff);

            int256 benchDiff = benchmark - outcome;
            int256 baselineBrier = benchDiff * benchDiff;
            int256 alphaComponent = baselineBrier - int256(brierComponent);

            totalBrier += brierComponent;
            totalAlpha += alphaComponent;
            scoredMarkets++;
        }

        Score storage s = _scores[roundId][msg.sender];
        s.totalMarkets = uint16(r.conditionIds.length);
        s.scoredMarkets = scoredMarkets;

        if (scoredMarkets > 0) {
            s.brierScore = totalBrier / uint256(scoredMarkets);
            s.alphaScore = totalAlpha / int256(uint256(scoredMarkets));
        }

        emit Revealed(roundId, msg.sender, predictions, scoredMarkets);
        emit ScoreComputed(roundId, msg.sender, s.brierScore, s.alphaScore, scoredMarkets);

        // Accrue gas rebate
        if (address(gasRebate) != address(0)) {
            gasRebate.accrueRebate(msg.sender);
        }
    }

    function getCommitment(uint256 roundId, address agent) external view returns (Commitment memory) {
        return _commitments[roundId][agent];
    }

    function getRevealedPredictions(uint256 roundId, address agent) external view returns (uint16[] memory) {
        return _revealedPredictions[roundId][agent];
    }

    function getScore(uint256 roundId, address agent) external view returns (Score memory) {
        return _scores[roundId][agent];
    }

    function getCommitCount(uint256 roundId) external view returns (uint256) {
        return commitCount[roundId];
    }

    function hasCommitted(uint256 roundId, address agent) external view returns (bool) {
        return _commitments[roundId][agent].commitHash != bytes32(0);
    }

    function hasRevealed(uint256 roundId, address agent) external view returns (bool) {
        return _commitments[roundId][agent].revealed;
    }
}
