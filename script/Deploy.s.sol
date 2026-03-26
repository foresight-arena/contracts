// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";
import {RoundManager} from "../src/RoundManager.sol";
import {PredictionArena} from "../src/PredictionArena.sol";
import {GasRebate} from "../src/GasRebate.sol";

contract Deploy is Script {
    function run() external {
        address curator = vm.envAddress("CURATOR_ADDRESS");
        address admin = vm.envAddress("ADMIN_ADDRESS");
        address ctf = vm.envAddress("CTF_ADDRESS");
        uint256 rebatePerReveal = vm.envUint("REBATE_PER_REVEAL");
        uint256 initialTreasury = vm.envUint("INITIAL_TREASURY");

        vm.startBroadcast();

        AgentRegistry registry = new AgentRegistry();
        console.log("AgentRegistry:", address(registry));

        RoundManager roundManager = new RoundManager(curator, admin);
        console.log("RoundManager:", address(roundManager));

        GasRebate gasRebate = new GasRebate(admin, address(0), rebatePerReveal);
        console.log("GasRebate:", address(gasRebate));

        PredictionArena arena = new PredictionArena(address(roundManager), ctf, address(gasRebate), admin);
        console.log("PredictionArena:", address(arena));

        // Link GasRebate to PredictionArena
        gasRebate.setPredictionArena(address(arena));
        console.log("GasRebate linked to PredictionArena");

        // Fund treasury if specified
        if (initialTreasury > 0) {
            gasRebate.fundTreasury{value: initialTreasury}();
            console.log("Treasury funded:", initialTreasury);
        }

        vm.stopBroadcast();
    }
}
