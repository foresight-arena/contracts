// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IPredictionArena} from "./interfaces/IPredictionArena.sol";
import {IRoundManager} from "./interfaces/IRoundManager.sol";
import {IConditionalTokens} from "./interfaces/IConditionalTokens.sol";

contract PredictionArena is IPredictionArena {
    IRoundManager public roundManager;
    IConditionalTokens public ctf;
    address public admin;

    mapping(uint256 => mapping(address => Commitment)) internal _commitments;
    mapping(uint256 => mapping(address => uint16[])) internal _revealedPredictions;
    mapping(uint256 => mapping(address => Score)) internal _scores;
    mapping(uint256 => uint256) public commitCount;

    // EIP-712 gasless support
    bytes32 public immutable DOMAIN_SEPARATOR;
    mapping(address => uint256) public nonces;

    bytes32 public constant COMMIT_TYPEHASH =
        keccak256("Commit(uint256 roundId,bytes32 commitHash,address agent,uint256 nonce,uint256 deadline)");

    bytes32 public constant REVEAL_TYPEHASH = keccak256(
        "Reveal(uint256 roundId,bytes32 predictionsHash,bytes32 salt,address agent,uint256 nonce,uint256 deadline)"
    );

    constructor(address _roundManager, address _ctf, address _admin) {
        require(_roundManager != address(0), "Invalid RoundManager");
        require(_ctf != address(0), "Invalid CTF");
        require(_admin != address(0), "Invalid admin");
        roundManager = IRoundManager(_roundManager);
        ctf = IConditionalTokens(_ctf);
        admin = _admin;

        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("PredictionArena"),
                keccak256("1"),
                block.chainid,
                address(this)
            )
        );
    }

    // ---------------------------------------------------------------
    // Direct (gas-paying) paths
    // ---------------------------------------------------------------

    function commit(uint256 roundId, bytes32 commitHash) external {
        _commit(roundId, commitHash, msg.sender);
    }

    function reveal(uint256 roundId, uint16[] calldata predictions, bytes32 salt) external {
        _reveal(roundId, predictions, salt, msg.sender);
    }

    // ---------------------------------------------------------------
    // Gasless (signature) paths
    // ---------------------------------------------------------------

    function commitWithSignature(
        uint256 roundId,
        bytes32 commitHash,
        address agent,
        uint256 deadline,
        bytes calldata signature
    ) external {
        require(block.timestamp <= deadline, "Signature expired");

        bytes32 structHash =
            keccak256(abi.encode(COMMIT_TYPEHASH, roundId, commitHash, agent, nonces[agent]++, deadline));
        _verifySignature(agent, structHash, signature);

        _commit(roundId, commitHash, agent);
    }

    function revealWithSignature(
        uint256 roundId,
        uint16[] calldata predictions,
        bytes32 salt,
        address agent,
        uint256 deadline,
        bytes calldata signature
    ) external {
        require(block.timestamp <= deadline, "Signature expired");

        // EIP-712 encodes dynamic arrays as keccak256 of their tight encoding
        // abi.encodePacked(uint16[]) pads to 32 bytes per element, so we pack manually
        bytes memory packedPredictions = new bytes(0);
        for (uint256 i = 0; i < predictions.length; i++) {
            packedPredictions = abi.encodePacked(packedPredictions, predictions[i]);
        }
        bytes32 structHash = keccak256(
            abi.encode(REVEAL_TYPEHASH, roundId, keccak256(packedPredictions), salt, agent, nonces[agent]++, deadline)
        );
        _verifySignature(agent, structHash, signature);

        _reveal(roundId, predictions, salt, agent);
    }

    // ---------------------------------------------------------------
    // Internal logic
    // ---------------------------------------------------------------

    function _verifySignature(address expected, bytes32 structHash, bytes calldata signature) internal view {
        require(signature.length == 65, "Invalid signature length");

        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));

        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }

        address recovered = ecrecover(digest, v, r, s);
        require(recovered != address(0) && recovered == expected, "Invalid signature");
    }

    function _commit(uint256 roundId, bytes32 commitHash, address agent) internal {
        require(commitHash != bytes32(0), "Empty hash");

        IRoundManager.Round memory r = roundManager.getRound(roundId);
        require(r.conditionIds.length > 0, "Round does not exist");
        require(!r.invalidated, "Round invalidated");
        require(uint64(block.timestamp) < r.commitDeadline, "Commit phase ended");

        Commitment storage c = _commitments[roundId][agent];
        require(c.commitHash == bytes32(0), "Already committed");

        c.commitHash = commitHash;
        commitCount[roundId]++;

        emit Committed(roundId, agent, commitHash);
    }

    function _reveal(uint256 roundId, uint16[] calldata predictions, bytes32 salt, address agent) internal {
        IRoundManager.Round memory r = roundManager.getRound(roundId);
        require(r.conditionIds.length > 0, "Round does not exist");
        require(!r.invalidated, "Round invalidated");
        require(uint64(block.timestamp) >= r.revealStart, "Reveal not started");
        require(uint64(block.timestamp) < r.revealDeadline, "Reveal phase ended");
        require(r.benchmarksPosted, "Benchmarks not posted");

        Commitment storage c = _commitments[roundId][agent];
        require(c.commitHash != bytes32(0), "No commitment");
        require(!c.revealed, "Already revealed");
        require(predictions.length == r.conditionIds.length, "Wrong prediction count");

        // Verify hash — manually pack uint16[] as tight 2-byte elements
        bytes memory packed = abi.encodePacked(roundId);
        for (uint256 i = 0; i < predictions.length; i++) {
            packed = abi.encodePacked(packed, predictions[i]);
        }
        bytes32 expectedHash = keccak256(abi.encodePacked(packed, salt));
        require(expectedHash == c.commitHash, "Hash mismatch");

        // Validate predictions
        for (uint256 i = 0; i < predictions.length; i++) {
            require(predictions[i] <= 10000, "Prediction out of range");
        }

        c.revealed = true;
        _revealedPredictions[roundId][agent] = predictions;

        // Compute and store scores
        _computeScores(roundId, agent, predictions, r);
    }

    function _computeScores(uint256 roundId, address agent, uint16[] calldata predictions, IRoundManager.Round memory r)
        internal
    {
        uint256 totalBrier;
        int256 totalAlpha;
        uint16 scoredMarkets;

        for (uint256 i = 0; i < r.conditionIds.length; i++) {
            bytes32 conditionId = r.conditionIds[i];

            uint256 denom = ctf.payoutDenominator(conditionId);
            if (denom == 0) continue;

            uint256 payout0 = ctf.payoutNumerators(conditionId, 0);
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

        Score storage s = _scores[roundId][agent];
        s.totalMarkets = uint16(r.conditionIds.length);
        s.scoredMarkets = scoredMarkets;

        if (scoredMarkets > 0) {
            s.brierScore = totalBrier / uint256(scoredMarkets);
            s.alphaScore = totalAlpha / int256(uint256(scoredMarkets));
        }

        emit Revealed(roundId, agent, predictions, scoredMarkets);
        emit ScoreComputed(roundId, agent, s.brierScore, s.alphaScore, scoredMarkets);
    }

    // ---------------------------------------------------------------
    // View functions
    // ---------------------------------------------------------------

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
