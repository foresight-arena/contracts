// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import {RoundManager} from "../src/RoundManager.sol";
import {PredictionArena} from "../src/PredictionArena.sol";

contract Deploy is Script {
    // Canonical ERC-8004 registry addresses (same across all chains)
    address constant CANONICAL_REPUTATION_REGISTRY = 0x8004BAa17C55a88189AE136b182e5fdA19dE9b63;

    function run() external {
        address curator = vm.envAddress("CURATOR_ADDRESS");
        address admin = vm.envAddress("ADMIN_ADDRESS");
        address ctf = vm.envAddress("CTF_ADDRESS");
        address reputationRegistry = vm.envOr("REPUTATION_REGISTRY_ADDRESS", CANONICAL_REPUTATION_REGISTRY);
        address existingRoundManager = vm.envOr("ROUND_MANAGER_ADDRESS", address(0));

        vm.startBroadcast();

        address roundManagerAddr;
        if (existingRoundManager != address(0)) {
            roundManagerAddr = existingRoundManager;
            console.log("  Using existing RoundManager:", roundManagerAddr);
        } else {
            RoundManager rm = new RoundManager(curator, admin);
            roundManagerAddr = address(rm);
        }

        PredictionArena arena = new PredictionArena(roundManagerAddr, ctf, reputationRegistry, admin);

        vm.stopBroadcast();

        console.log("");
        console.log("==========================================================");
        console.log("  DEPLOYMENT COMPLETE");
        console.log("==========================================================");
        console.log("");
        console.log("  RoundManager:        ", roundManagerAddr);
        console.log("  PredictionArena:     ", address(arena));
        console.log("");
        console.log("  Reputation Registry: ", reputationRegistry);
        console.log("  CTF (external):      ", ctf);
        console.log("  Curator:             ", curator);
        console.log("  Admin:               ", admin);
        console.log("==========================================================");
    }
}
