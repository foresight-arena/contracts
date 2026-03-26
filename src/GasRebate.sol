// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IGasRebate} from "./interfaces/IGasRebate.sol";

contract GasRebate is IGasRebate {
    mapping(address => uint256) public claimable;
    uint256 public rebatePerReveal;
    uint256 public totalDistributed;
    bool public active;
    address public admin;
    address public predictionArena;

    bool private _locked;

    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin");
        _;
    }

    modifier nonReentrant() {
        require(!_locked, "Reentrant call");
        _locked = true;
        _;
        _locked = false;
    }

    constructor(address _admin, address _predictionArena, uint256 _rebatePerReveal) {
        require(_admin != address(0), "Invalid admin");
        admin = _admin;
        predictionArena = _predictionArena;
        rebatePerReveal = _rebatePerReveal;
        active = true;
    }

    function accrueRebate(address agent) external {
        require(msg.sender == predictionArena, "Only PredictionArena");
        if (!active) return;

        claimable[agent] += rebatePerReveal;
        totalDistributed += rebatePerReveal;

        emit RebateAccrued(agent, rebatePerReveal);
    }

    function claimRebate() external nonReentrant {
        uint256 amount = claimable[msg.sender];
        require(amount > 0, "Nothing to claim");

        uint256 balance = address(this).balance;
        uint256 payout = amount < balance ? amount : balance;

        claimable[msg.sender] -= payout;

        (bool success,) = msg.sender.call{value: payout}("");
        require(success, "Transfer failed");

        emit RebateClaimed(msg.sender, payout);
    }

    function fundTreasury() external payable {
        require(msg.value > 0, "No value");
        emit TreasuryFunded(msg.sender, msg.value);
    }

    function setRebatePerReveal(uint256 amount) external onlyAdmin {
        uint256 old = rebatePerReveal;
        rebatePerReveal = amount;
        emit RebateRateChanged(old, amount);
    }

    function setActive(bool _active) external onlyAdmin {
        active = _active;
    }

    function setPredictionArena(address _predictionArena) external onlyAdmin {
        predictionArena = _predictionArena;
    }

    function withdrawTreasury(address to) external onlyAdmin {
        require(to != address(0), "Invalid address");
        uint256 balance = address(this).balance;
        (bool success,) = to.call{value: balance}("");
        require(success, "Transfer failed");
    }

    function getClaimable(address agent) external view returns (uint256) {
        return claimable[agent];
    }

    function getTreasuryBalance() external view returns (uint256) {
        return address(this).balance;
    }
}
