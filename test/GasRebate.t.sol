// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/GasRebate.sol";
import "../src/interfaces/IGasRebate.sol";

/// @dev Helper contract that attempts reentrancy on claimRebate via receive().
contract ReentrantAttacker {
    GasRebate public target;
    uint256 public attackCount;

    constructor(address _target) {
        target = GasRebate(_target);
    }

    function attack() external {
        target.claimRebate();
    }

    receive() external payable {
        if (attackCount < 1) {
            attackCount++;
            target.claimRebate();
        }
    }
}

contract GasRebateTest is Test {
    GasRebate public rebate;

    address admin = makeAddr("admin");
    address arena = makeAddr("arena");
    address user = makeAddr("user");
    address user2 = makeAddr("user2");

    uint256 constant REBATE_AMOUNT = 0.001 ether;

    event RebateAccrued(address indexed agent, uint256 amount);
    event RebateClaimed(address indexed agent, uint256 amount);
    event TreasuryFunded(address indexed funder, uint256 amount);
    event RebateRateChanged(uint256 oldRate, uint256 newRate);

    function setUp() public {
        rebate = new GasRebate(admin, arena, REBATE_AMOUNT);
        // Fund the treasury so claims can succeed.
        vm.deal(address(rebate), 10 ether);
    }

    // ---------------------------------------------------------------
    // accrueRebate
    // ---------------------------------------------------------------

    function test_accrueRebate_success() public {
        vm.prank(arena);
        vm.expectEmit(true, false, false, true, address(rebate));
        emit RebateAccrued(user, REBATE_AMOUNT);
        rebate.accrueRebate(user);

        assertEq(rebate.claimable(user), REBATE_AMOUNT);
        assertEq(rebate.totalDistributed(), REBATE_AMOUNT);
    }

    function test_accrueRebate_onlyArena() public {
        vm.prank(user);
        vm.expectRevert("Only PredictionArena");
        rebate.accrueRebate(user);
    }

    function test_accrueRebate_inactive() public {
        // Pause the contract.
        vm.prank(admin);
        rebate.setActive(false);

        // Call from arena — should silently return without accruing.
        vm.prank(arena);
        rebate.accrueRebate(user);

        assertEq(rebate.claimable(user), 0);
        assertEq(rebate.totalDistributed(), 0);
    }

    function test_accrueRebate_multiple() public {
        vm.startPrank(arena);
        rebate.accrueRebate(user);
        rebate.accrueRebate(user);
        rebate.accrueRebate(user);
        vm.stopPrank();

        assertEq(rebate.claimable(user), REBATE_AMOUNT * 3);
        assertEq(rebate.totalDistributed(), REBATE_AMOUNT * 3);
    }

    // ---------------------------------------------------------------
    // claimRebate
    // ---------------------------------------------------------------

    function test_claimRebate_success() public {
        // Accrue first.
        vm.prank(arena);
        rebate.accrueRebate(user);

        uint256 balBefore = user.balance;

        vm.prank(user);
        vm.expectEmit(true, false, false, true, address(rebate));
        emit RebateClaimed(user, REBATE_AMOUNT);
        rebate.claimRebate();

        assertEq(rebate.claimable(user), 0);
        assertEq(user.balance, balBefore + REBATE_AMOUNT);
    }

    function test_claimRebate_noBalance() public {
        vm.prank(user);
        vm.expectRevert("Nothing to claim");
        rebate.claimRebate();
    }

    function test_claimRebate_partialTreasury() public {
        // Deploy a fresh contract with a tiny treasury.
        GasRebate lean = new GasRebate(admin, arena, 1 ether);
        vm.deal(address(lean), 0.3 ether);

        // Accrue 1 ether of claimable.
        vm.prank(arena);
        lean.accrueRebate(user);

        uint256 balBefore = user.balance;

        vm.prank(user);
        lean.claimRebate();

        // Should have received only the available 0.3 ether.
        assertEq(user.balance, balBefore + 0.3 ether);
        // Leftover 0.7 ether remains claimable.
        assertEq(lean.claimable(user), 0.7 ether);
    }

    function test_claimRebate_reentrancy() public {
        ReentrantAttacker attacker = new ReentrantAttacker(address(rebate));

        // Accrue twice for the attacker so the claimable check won't block the reentrant call.
        // The reentrancy guard should be the blocker.
        vm.startPrank(arena);
        rebate.accrueRebate(address(attacker));
        rebate.accrueRebate(address(attacker));
        vm.stopPrank();

        // The attacker's receive() tries to call claimRebate again.
        // The inner call reverts with "Reentrant call", causing the
        // outer transfer to fail with "Transfer failed".
        vm.expectRevert("Transfer failed");
        attacker.attack();
    }

    // ---------------------------------------------------------------
    // fundTreasury
    // ---------------------------------------------------------------

    function test_fundTreasury() public {
        GasRebate fresh = new GasRebate(admin, arena, REBATE_AMOUNT);

        vm.deal(user, 5 ether);
        vm.prank(user);
        vm.expectEmit(true, false, false, true, address(fresh));
        emit TreasuryFunded(user, 2 ether);
        fresh.fundTreasury{value: 2 ether}();

        assertEq(address(fresh).balance, 2 ether);
    }

    // ---------------------------------------------------------------
    // withdrawTreasury
    // ---------------------------------------------------------------

    function test_withdrawTreasury_success() public {
        uint256 treasuryBal = address(rebate).balance;
        uint256 adminBalBefore = admin.balance;

        vm.prank(admin);
        rebate.withdrawTreasury(admin);

        assertEq(admin.balance, adminBalBefore + treasuryBal);
        assertEq(address(rebate).balance, 0);
    }

    function test_withdrawTreasury_onlyAdmin() public {
        vm.prank(user);
        vm.expectRevert("Only admin");
        rebate.withdrawTreasury(user);
    }

    // ---------------------------------------------------------------
    // setRebatePerReveal
    // ---------------------------------------------------------------

    function test_setRebatePerReveal() public {
        uint256 newRate = 0.005 ether;

        vm.prank(admin);
        vm.expectEmit(false, false, false, true, address(rebate));
        emit RebateRateChanged(REBATE_AMOUNT, newRate);
        rebate.setRebatePerReveal(newRate);

        assertEq(rebate.rebatePerReveal(), newRate);

        // New accrual should use the new rate.
        vm.prank(arena);
        rebate.accrueRebate(user);

        assertEq(rebate.claimable(user), newRate);
    }

    // ---------------------------------------------------------------
    // setActive
    // ---------------------------------------------------------------

    function test_setActive() public {
        // Deactivate.
        vm.prank(admin);
        rebate.setActive(false);
        assertEq(rebate.active(), false);

        // Accrual should be silently skipped.
        vm.prank(arena);
        rebate.accrueRebate(user);
        assertEq(rebate.claimable(user), 0);

        // Reactivate.
        vm.prank(admin);
        rebate.setActive(true);
        assertEq(rebate.active(), true);

        // Accrual should work again.
        vm.prank(arena);
        rebate.accrueRebate(user);
        assertEq(rebate.claimable(user), REBATE_AMOUNT);
    }

    // ---------------------------------------------------------------
    // setPredictionArena
    // ---------------------------------------------------------------

    function test_setPredictionArena() public {
        address newArena = makeAddr("newArena");

        vm.prank(admin);
        rebate.setPredictionArena(newArena);

        assertEq(rebate.predictionArena(), newArena);

        // Old arena can no longer accrue.
        vm.prank(arena);
        vm.expectRevert("Only PredictionArena");
        rebate.accrueRebate(user);

        // New arena can accrue.
        vm.prank(newArena);
        rebate.accrueRebate(user);
        assertEq(rebate.claimable(user), REBATE_AMOUNT);
    }
}
