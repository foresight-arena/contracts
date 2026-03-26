// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IGasRebate {
    event RebateAccrued(address indexed agent, uint256 amount);
    event RebateClaimed(address indexed agent, uint256 amount);
    event TreasuryFunded(address indexed funder, uint256 amount);
    event RebateRateChanged(uint256 oldRate, uint256 newRate);

    function accrueRebate(address agent) external;
    function claimRebate() external;
    function fundTreasury() external payable;
    function setRebatePerReveal(uint256 amount) external;
    function setActive(bool _active) external;
    function withdrawTreasury(address to) external;

    function getClaimable(address agent) external view returns (uint256);
    function getTreasuryBalance() external view returns (uint256);
}
