// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import {PredictionArena} from "../src/PredictionArena.sol";

contract DeployTestnetResume is Script {
    function run() external {
        address deployer = msg.sender;

        address roundManager = 0xc90d43741Bba325e38BfF0801cAe341499651DCC;
        address mockCtf = 0x4aF09f4A542ceD3E3957fD3A11590144b1008dD1;

        vm.startBroadcast();

        PredictionArena arena = new PredictionArena(roundManager, mockCtf, deployer);
        console.log("PredictionArena:", address(arena));

        vm.stopBroadcast();
    }
}
