// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";
import {RoundManager} from "../src/RoundManager.sol";
import {PredictionArena} from "../src/PredictionArena.sol";

import {MockConditionalTokens} from "../test/mocks/MockConditionalTokens.sol";

contract DeployTestnet is Script {
    function run() external {
        address deployer = msg.sender;
        uint256 rebatePerReveal = 0.005 ether; // 0.005 POL per reveal

        vm.startBroadcast();

        // Deploy MockCTF so we can set payouts for testing
        MockConditionalTokens mockCtf = new MockConditionalTokens();
        console.log("MockConditionalTokens:", address(mockCtf));

        AgentRegistry registry = new AgentRegistry();
        console.log("AgentRegistry:", address(registry));

        // Deployer is both curator and admin on testnet
        RoundManager roundManager = new RoundManager(deployer, deployer);
        console.log("RoundManager:", address(roundManager));

        PredictionArena arena = new PredictionArena(address(roundManager), address(mockCtf), deployer);
        console.log("PredictionArena:", address(arena));

        vm.stopBroadcast();
    }
}
