// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";
import {RoundManager} from "../src/RoundManager.sol";
import {FastRoundManager} from "../src/FastRoundManager.sol";
import {PredictionArena} from "../src/PredictionArena.sol";
import {GasRebate} from "../src/GasRebate.sol";

contract Deploy is Script {
    function run() external {
        address curator = vm.envAddress("CURATOR_ADDRESS");
        address admin = vm.envAddress("ADMIN_ADDRESS");
        address ctf = vm.envAddress("CTF_ADDRESS");
        uint256 rebatePerReveal = vm.envUint("REBATE_PER_REVEAL");
        uint256 initialTreasury = vm.envUint("INITIAL_TREASURY");
        bool fastMode = vm.envOr("FAST_MODE", false);

        vm.startBroadcast();

        AgentRegistry registry = new AgentRegistry();

        address roundManagerAddr;
        if (fastMode) {
            FastRoundManager fastRm = new FastRoundManager(curator, admin);
            roundManagerAddr = address(fastRm);
        } else {
            RoundManager rm = new RoundManager(curator, admin);
            roundManagerAddr = address(rm);
        }

        GasRebate gasRebate = new GasRebate(admin, address(0), rebatePerReveal);

        PredictionArena arena = new PredictionArena(roundManagerAddr, ctf, address(gasRebate), admin);

        gasRebate.setPredictionArena(address(arena));

        if (initialTreasury > 0) {
            gasRebate.fundTreasury{value: initialTreasury}();
        }

        vm.stopBroadcast();

        // --- Deployment summary ---
        console.log("");
        console.log("==========================================================");
        console.log("  DEPLOYMENT COMPLETE");
        console.log("==========================================================");
        console.log("");
        if (fastMode) {
            console.log("  Mode:              FAST (no time constraints)");
        } else {
            console.log("  Mode:              PRODUCTION (1h commit, 2h buffer, 12h reveal)");
        }
        console.log("");
        console.log("  AgentRegistry:     ", address(registry));
        console.log("  RoundManager:      ", roundManagerAddr);
        console.log("  GasRebate:         ", address(gasRebate));
        console.log("  PredictionArena:   ", address(arena));
        console.log("");
        console.log("  CTF (external):    ", ctf);
        console.log("  Curator:           ", curator);
        console.log("  Admin:             ", admin);
        console.log("  Rebate per reveal: ", rebatePerReveal);
        if (initialTreasury > 0) {
            console.log("  Treasury funded:   ", initialTreasury);
        }
        console.log("==========================================================");
    }
}
