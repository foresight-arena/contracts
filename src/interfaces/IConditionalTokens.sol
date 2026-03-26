// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IConditionalTokens {
    function payoutNumerators(bytes32 conditionId, uint256 index) external view returns (uint256);
    function payoutDenominator(bytes32 conditionId) external view returns (uint256);
}
