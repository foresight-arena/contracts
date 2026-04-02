// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {RoundManager} from "./RoundManager.sol";

/// @title FastRoundManager
/// @notice RoundManager variant with no time constraints, for testing on mainnet/testnet.
///         Only constraints: commitDeadline in the future, revealStart after commitDeadline,
///         revealDeadline after revealStart.
contract FastRoundManager is RoundManager {
    constructor(address _curator, address _admin) RoundManager(_curator, _admin) {}

    function createRound(
        bytes32[] calldata conditionIds,
        uint64 commitDeadline,
        uint64 revealStart,
        uint64 revealDeadline,
        uint16 minResolvedMarkets
    ) external override onlyCurator returns (uint256 roundId) {
        require(conditionIds.length >= 1 && conditionIds.length <= 20, "Invalid market count");
        require(commitDeadline > uint64(block.timestamp), "Commit deadline must be in future");
        require(revealStart >= commitDeadline, "Reveal start must be after commit deadline");
        require(revealDeadline > revealStart, "Reveal deadline must be after reveal start");
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
}
