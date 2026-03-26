// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";
import {IAgentRegistry} from "../src/interfaces/IAgentRegistry.sol";

contract AgentRegistryTest is Test {
    AgentRegistry internal registry;

    address internal agent1 = address(0xA1);
    address internal owner1 = address(0xB1);

    event AgentRegistered(address indexed agent, string name, string url, address owner);
    event AgentUpdated(address indexed agent, string name, string url, address owner);

    function setUp() public {
        registry = new AgentRegistry();
    }

    // ---------------------------------------------------------------
    // registerAgent
    // ---------------------------------------------------------------

    function test_register_success() public {
        vm.prank(agent1);

        vm.expectEmit(true, false, false, true, address(registry));
        emit AgentRegistered(agent1, "Alice", "https://alice.ai", owner1);

        registry.registerAgent("Alice", "https://alice.ai", owner1);

        IAgentRegistry.Agent memory a = registry.getAgent(agent1);
        assertEq(a.name, "Alice");
        assertEq(a.url, "https://alice.ai");
        assertEq(a.owner, owner1);
        assertEq(a.registeredAt, uint64(block.timestamp));
        assertTrue(registry.isRegistered(agent1));
    }

    function test_register_noUrl() public {
        vm.prank(agent1);
        registry.registerAgent("Bob", "", owner1);

        IAgentRegistry.Agent memory a = registry.getAgent(agent1);
        assertEq(a.name, "Bob");
        assertEq(a.url, "");
        assertEq(a.owner, owner1);
        assertTrue(registry.isRegistered(agent1));
    }

    function test_register_noOwner() public {
        vm.prank(agent1);
        registry.registerAgent("Carol", "https://carol.ai", address(0));

        IAgentRegistry.Agent memory a = registry.getAgent(agent1);
        assertEq(a.name, "Carol");
        assertEq(a.owner, address(0));
        assertTrue(registry.isRegistered(agent1));
    }

    function test_register_duplicate() public {
        vm.startPrank(agent1);
        registry.registerAgent("Dave", "https://dave.ai", owner1);

        vm.expectRevert("Already registered");
        registry.registerAgent("Dave2", "https://dave2.ai", owner1);
        vm.stopPrank();
    }

    function test_register_emptyName() public {
        vm.prank(agent1);
        vm.expectRevert("Name required");
        registry.registerAgent("", "https://x.ai", owner1);
    }

    function test_register_longName() public {
        // 65 bytes — one over the 64-byte limit
        string memory longName = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
        assertEq(bytes(longName).length, 65);

        vm.prank(agent1);
        vm.expectRevert("Name too long");
        registry.registerAgent(longName, "https://x.ai", owner1);
    }

    function test_register_longUrl() public {
        // Build a URL that is 257 bytes long
        bytes memory buf = new bytes(257);
        for (uint256 i; i < 257; i++) {
            buf[i] = "x";
        }
        string memory longUrl = string(buf);

        vm.prank(agent1);
        vm.expectRevert("URL too long");
        registry.registerAgent("Valid", longUrl, owner1);
    }

    // ---------------------------------------------------------------
    // updateAgent
    // ---------------------------------------------------------------

    function test_update_success() public {
        vm.startPrank(agent1);
        registry.registerAgent("Eve", "https://eve.ai", owner1);

        address newOwner = address(0xC1);

        vm.expectEmit(true, false, false, true, address(registry));
        emit AgentUpdated(agent1, "Eve2", "https://eve2.ai", newOwner);

        registry.updateAgent("Eve2", "https://eve2.ai", newOwner);
        vm.stopPrank();

        IAgentRegistry.Agent memory a = registry.getAgent(agent1);
        assertEq(a.name, "Eve2");
        assertEq(a.url, "https://eve2.ai");
        assertEq(a.owner, newOwner);
        // registeredAt should remain unchanged from the original registration
        assertEq(a.registeredAt, uint64(block.timestamp));
    }

    function test_update_notRegistered() public {
        vm.prank(agent1);
        vm.expectRevert("Not registered");
        registry.updateAgent("Ghost", "https://ghost.ai", owner1);
    }

    // ---------------------------------------------------------------
    // isRegistered
    // ---------------------------------------------------------------

    function test_isRegistered_true() public {
        vm.prank(agent1);
        registry.registerAgent("Frank", "https://frank.ai", owner1);

        assertTrue(registry.isRegistered(agent1));
    }

    function test_isRegistered_false() public view {
        assertFalse(registry.isRegistered(address(0xDEAD)));
    }

    // ---------------------------------------------------------------
    // getAgent
    // ---------------------------------------------------------------

    function test_getAgent() public {
        uint256 ts = 1_700_000_000;
        vm.warp(ts);

        vm.prank(agent1);
        registry.registerAgent("Grace", "https://grace.ai", owner1);

        IAgentRegistry.Agent memory a = registry.getAgent(agent1);
        assertEq(a.name, "Grace");
        assertEq(a.url, "https://grace.ai");
        assertEq(a.owner, owner1);
        assertEq(a.registeredAt, uint64(ts));
    }
}
