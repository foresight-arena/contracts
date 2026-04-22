// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import {RoundManager} from "../src/RoundManager.sol";
import {PredictionArena} from "../src/PredictionArena.sol";

import {MockConditionalTokens} from "../test/mocks/MockConditionalTokens.sol";

contract DeployTestnet is Script {
    function run() external {
        address deployer = msg.sender;

        vm.startBroadcast();

        // Deploy MockCTF so we can set payouts for testing
        MockConditionalTokens mockCtf = new MockConditionalTokens();
        console.log("MockConditionalTokens:", address(mockCtf));

        // Deployer is both curator and admin on testnet
        RoundManager roundManager = new RoundManager(deployer, deployer);
        console.log("RoundManager:", address(roundManager));

        PredictionArena arena = new PredictionArena(address(roundManager), address(mockCtf), address(0), deployer);
        console.log("PredictionArena:", address(arena));

        vm.stopBroadcast();
    }
}
