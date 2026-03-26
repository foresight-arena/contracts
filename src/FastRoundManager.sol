// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {RoundManager} from "./RoundManager.sol";

/// @title FastRoundManager
/// @notice RoundManager variant with no time constraints, for testing on mainnet/testnet.
///         Only constraint: commitDeadline must be in the future, revealDeadline after commitDeadline.
///         Oracle buffer is set to 0 — curator is responsible for ensuring oracle finality before posting benchmarks.
contract FastRoundManager is RoundManager {
    constructor(address _curator, address _admin) RoundManager(_curator, _admin) {}

    /// @notice Create a round with no minimum window constraints.
    /// @dev Overrides the parent createRound by bypassing time minimums.
    ///      revealStart = commitDeadline (no oracle buffer enforced on-chain).
    function createRound(bytes32[] calldata conditionIds, uint64 commitDeadline, uint64 revealDeadline)
        external
        override
        onlyCurator
        returns (uint256 roundId)
    {
        require(conditionIds.length >= 1 && conditionIds.length <= 20, "Invalid market count");
        require(commitDeadline > uint64(block.timestamp), "Commit deadline must be in future");
        require(revealDeadline > commitDeadline, "Reveal deadline must be after commit deadline");

        roundId = ++currentRoundId;
        Round storage r = _rounds[roundId];
        r.conditionIds = conditionIds;
        r.commitDeadline = commitDeadline;
        r.revealStart = commitDeadline; // no buffer — reveal starts immediately after commit
        r.revealDeadline = revealDeadline;

        emit RoundCreated(roundId, conditionIds, commitDeadline, revealDeadline);
    }
}
