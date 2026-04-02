// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";
import {RoundManager} from "../src/RoundManager.sol";
import {FastRoundManager} from "../src/FastRoundManager.sol";
import {PredictionArena} from "../src/PredictionArena.sol";

contract Deploy is Script {
    function run() external {
        address curator = vm.envAddress("CURATOR_ADDRESS");
        address admin = vm.envAddress("ADMIN_ADDRESS");
        address ctf = vm.envAddress("CTF_ADDRESS");
        bool fastMode = vm.envOr("FAST_MODE", false);
        address existingRegistry = vm.envOr("AGENT_REGISTRY_ADDRESS", address(0));

        vm.startBroadcast();

        address registryAddr;
        if (existingRegistry != address(0)) {
            registryAddr = existingRegistry;
            console.log("  Using existing AgentRegistry:", registryAddr);
        } else {
            AgentRegistry registry = new AgentRegistry();
            registryAddr = address(registry);
        }

        address roundManagerAddr;
        if (fastMode) {
            FastRoundManager fastRm = new FastRoundManager(curator, admin);
            roundManagerAddr = address(fastRm);
        } else {
            RoundManager rm = new RoundManager(curator, admin);
            roundManagerAddr = address(rm);
        }

        PredictionArena arena = new PredictionArena(roundManagerAddr, ctf, admin);

        vm.stopBroadcast();

        console.log("");
        console.log("==========================================================");
        console.log("  DEPLOYMENT COMPLETE");
        console.log("==========================================================");
        console.log("");
        if (fastMode) {
            console.log("  Mode:              FAST (no time constraints)");
        } else {
            console.log("  Mode:              PRODUCTION");
        }
        console.log("");
        console.log("  AgentRegistry:     ", registryAddr);
        console.log("  RoundManager:      ", roundManagerAddr);
        console.log("  PredictionArena:   ", address(arena));
        console.log("");
        console.log("  CTF (external):    ", ctf);
        console.log("  Curator:           ", curator);
        console.log("  Admin:             ", admin);
        console.log("==========================================================");
    }
}
