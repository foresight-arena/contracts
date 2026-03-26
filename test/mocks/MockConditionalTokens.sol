// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockConditionalTokens {
    mapping(bytes32 => uint256[]) internal _payoutNumerators;
    mapping(bytes32 => uint256) internal _payoutDenominator;

    function setPayouts(bytes32 conditionId, uint256[] calldata payouts) external {
        _payoutNumerators[conditionId] = payouts;
        uint256 denom;
        for (uint256 i = 0; i < payouts.length; i++) {
            denom += payouts[i];
        }
        _payoutDenominator[conditionId] = denom;
    }

    function clearPayouts(bytes32 conditionId) external {
        delete _payoutNumerators[conditionId];
        _payoutDenominator[conditionId] = 0;
    }

    function payoutNumerators(bytes32 conditionId, uint256 index) external view returns (uint256) {
        return _payoutNumerators[conditionId][index];
    }

    function payoutDenominator(bytes32 conditionId) external view returns (uint256) {
        return _payoutDenominator[conditionId];
    }
}
