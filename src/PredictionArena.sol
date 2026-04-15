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

    // Two-phase outcome resolution
    struct RoundOutcomes {
        uint256 resolvedBitmask; // bit i set = market i resolved + binary
        int256[] cachedOutcomes; // 10000 or 0 per market (valid where bit set)
        bool outcomesTriggered; // single-trigger guard
        address[] pendingScoring; // agents revealed before outcomes triggered
    }

    mapping(uint256 => RoundOutcomes) internal _roundOutcomes;

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

    uint256 private constant DIRECT_CALL_NONCE = type(uint256).max;

    function commit(uint256 roundId, bytes32 commitHash) external {
        _commit(roundId, commitHash, msg.sender, DIRECT_CALL_NONCE);
    }

    function reveal(uint256 roundId, uint16[] calldata predictions, bytes32 salt) external {
        _reveal(roundId, predictions, salt, msg.sender, DIRECT_CALL_NONCE);
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

        uint256 nonce = nonces[agent]++;
        bytes32 structHash = keccak256(abi.encode(COMMIT_TYPEHASH, roundId, commitHash, agent, nonce, deadline));
        _verifySignature(agent, structHash, signature);

        _commit(roundId, commitHash, agent, nonce);
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

        uint256 nonce = nonces[agent]++;
        // Tight 2-byte packing for predictionsHash (matches commit hash encoding)
        bytes memory packedPredictions;
        for (uint256 i = 0; i < predictions.length; i++) {
            packedPredictions = abi.encodePacked(packedPredictions, predictions[i]);
        }
        bytes32 structHash =
            keccak256(abi.encode(REVEAL_TYPEHASH, roundId, keccak256(packedPredictions), salt, agent, nonce, deadline));
        _verifySignature(agent, structHash, signature);

        _reveal(roundId, predictions, salt, agent, nonce);
    }

    // ---------------------------------------------------------------
    // Outcome triggering (two-phase scoring)
    // ---------------------------------------------------------------

    function triggerOutcomes(uint256 roundId) external {
        _triggerOutcomes(roundId);
    }

    function triggerOutcomesAndScore(uint256 roundId) external {
        _triggerOutcomes(roundId);
        _scorePending(roundId);
    }

    function calculateScoresForPendingReveals(uint256 roundId) external {
        RoundOutcomes storage o = _roundOutcomes[roundId];
        require(o.outcomesTriggered, "Outcomes not triggered");
        _scorePending(roundId);
    }

    function _triggerOutcomes(uint256 roundId) internal {
        IRoundManager.Round memory r = roundManager.getRound(roundId);
        require(r.conditionIds.length > 0, "Round does not exist");
        require(!r.invalidated, "Round invalidated");
        require(r.benchmarksPosted, "Benchmarks not posted");

        // Curator-only during reveal window, permissionless after revealDeadline
        if (uint64(block.timestamp) < r.revealDeadline) {
            require(msg.sender == roundManager.curator() || msg.sender == admin, "Only curator during reveal window");
        }

        RoundOutcomes storage o = _roundOutcomes[roundId];
        require(!o.outcomesTriggered, "Outcomes already triggered");

        uint256 len = r.conditionIds.length;
        o.cachedOutcomes = new int256[](len);
        uint256 bitmask;
        uint16 resolvedCount;

        for (uint256 i = 0; i < len; i++) {
            bytes32 conditionId = r.conditionIds[i];
            uint256 denom = ctf.payoutDenominator(conditionId);
            if (denom == 0) continue;

            uint256 payout0 = ctf.payoutNumerators(conditionId, 0);
            // Skip non-binary resolutions (e.g. void/split 50/50)
            if (payout0 != 0 && payout0 != denom) continue;

            bitmask |= (1 << i);
            o.cachedOutcomes[i] = (payout0 > 0) ? int256(10000) : int256(0);
            resolvedCount++;
        }

        o.resolvedBitmask = bitmask;
        o.outcomesTriggered = true;

        emit OutcomesTriggered(roundId, bitmask, resolvedCount);
    }

    function _scorePending(uint256 roundId) internal {
        RoundOutcomes storage o = _roundOutcomes[roundId];
        IRoundManager.Round memory r = roundManager.getRound(roundId);

        uint256 count = o.pendingScoring.length;
        for (uint256 i = 0; i < count; i++) {
            _scoreAgent(roundId, o.pendingScoring[i], r);
        }

        // Clean up fully consumed array
        delete o.pendingScoring;

        emit PendingScoresProcessed(roundId, count, 0);
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

        // Reject malleable signatures: require s in lower half of secp256k1 order
        require(uint256(s) <= 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0, "Invalid signature");

        address recovered = ecrecover(digest, v, r, s);
        require(recovered != address(0) && recovered == expected, "Invalid signature");
    }

    function _commit(uint256 roundId, bytes32 commitHash, address agent, uint256 eventNonce) internal {
        require(commitHash != bytes32(0), "Empty hash");

        IRoundManager.Round memory r = roundManager.getRound(roundId);
        require(r.conditionIds.length > 0, "Round does not exist");
        require(!r.invalidated, "Round invalidated");
        require(uint64(block.timestamp) < r.commitDeadline, "Commit phase ended");

        Commitment storage c = _commitments[roundId][agent];
        require(c.commitHash == bytes32(0), "Already committed");

        c.commitHash = commitHash;
        commitCount[roundId]++;

        emit Committed(roundId, agent, commitHash, eventNonce);
    }

    function _reveal(uint256 roundId, uint16[] calldata predictions, bytes32 salt, address agent, uint256 eventNonce)
        internal
    {
        IRoundManager.Round memory r = roundManager.getRound(roundId);
        require(r.conditionIds.length > 0, "Round does not exist");
        require(!r.invalidated, "Round invalidated");
        require(uint64(block.timestamp) >= r.revealStart, "Reveal not started");
        require(uint64(block.timestamp) < r.revealDeadline, "Reveal phase ended");

        Commitment storage c = _commitments[roundId][agent];
        require(!c.revealed, "Already revealed");
        require(c.commitHash != bytes32(0), "No commitment");
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
        c.commitHash = bytes32(0); // Gas refund: hash no longer needed after verification
        _revealedPredictions[roundId][agent] = predictions;

        // If outcomes are already triggered, score inline. Otherwise, defer.
        RoundOutcomes storage o = _roundOutcomes[roundId];
        if (o.outcomesTriggered) {
            _scoreAgent(roundId, agent, r);
        } else {
            o.pendingScoring.push(agent);
            emit Revealed(roundId, agent, predictions, 0, eventNonce);
        }
    }

    function _scoreAgent(uint256 roundId, address agent, IRoundManager.Round memory r) internal {
        // Guard: don't double-score
        Score storage s = _scores[roundId][agent];
        if (s.totalMarkets > 0) return;

        RoundOutcomes storage o = _roundOutcomes[roundId];
        uint16[] memory predictions = _revealedPredictions[roundId][agent];

        uint256 totalBrier;
        int256 totalAlpha;
        uint16 scoredMarkets;

        for (uint256 i = 0; i < r.conditionIds.length; i++) {
            if (o.resolvedBitmask & (1 << i) == 0) continue;

            {
                int256 outcome = o.cachedOutcomes[i];
                int256 prediction = int256(uint256(predictions[i]));
                int256 benchmark = int256(uint256(r.benchmarkPrices[i]));

                int256 diff = prediction - outcome;
                uint256 brierComponent = uint256(diff * diff);

                int256 benchDiff = benchmark - outcome;
                int256 alphaComponent = (benchDiff * benchDiff) - int256(brierComponent);

                totalBrier += brierComponent;
                totalAlpha += alphaComponent;
            }
            scoredMarkets++;
        }

        s.totalMarkets = uint16(r.conditionIds.length);
        s.scoredMarkets = scoredMarkets;

        if (scoredMarkets > 0) {
            s.brierScore = totalBrier / uint256(scoredMarkets);
            s.alphaScore = totalAlpha / int256(uint256(scoredMarkets));
        }

        emit Revealed(roundId, agent, predictions, scoredMarkets, DIRECT_CALL_NONCE);
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

    function getRoundOutcomes(uint256 roundId)
        external
        view
        returns (bool triggered, uint256 bitmask, int256[] memory outcomes)
    {
        RoundOutcomes storage o = _roundOutcomes[roundId];
        return (o.outcomesTriggered, o.resolvedBitmask, o.cachedOutcomes);
    }

    function getPendingScoringCount(uint256 roundId) external view returns (uint256) {
        return _roundOutcomes[roundId].pendingScoring.length;
    }
}
