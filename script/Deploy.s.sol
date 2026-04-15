// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import {AgentNFT} from "../src/AgentNFT.sol";
import {RoundManager} from "../src/RoundManager.sol";
import {PredictionArena} from "../src/PredictionArena.sol";

contract Deploy is Script {
    function run() external {
        address curator = vm.envAddress("CURATOR_ADDRESS");
        address admin = vm.envAddress("ADMIN_ADDRESS");
        address ctf = vm.envAddress("CTF_ADDRESS");
        string memory baseURI = vm.envOr("AGENT_BASE_URI", string("https://api.foresightarena.xyz/agent/"));
        string memory feedbackBaseURI =
            vm.envOr("FEEDBACK_BASE_URI", string("https://api.foresightarena.xyz/reasoning/"));
        address existingAgentNFT = vm.envOr("AGENT_NFT_ADDRESS", address(0));
        address existingRoundManager = vm.envOr("ROUND_MANAGER_ADDRESS", address(0));

        vm.startBroadcast();

        address agentNFTAddr;
        if (existingAgentNFT != address(0)) {
            agentNFTAddr = existingAgentNFT;
            console.log("  Using existing AgentNFT:", agentNFTAddr);
        } else {
            AgentNFT nft = new AgentNFT(baseURI);
            agentNFTAddr = address(nft);
        }

        address roundManagerAddr;
        if (existingRoundManager != address(0)) {
            roundManagerAddr = existingRoundManager;
            console.log("  Using existing RoundManager:", roundManagerAddr);
        } else {
            RoundManager rm = new RoundManager(curator, admin);
            roundManagerAddr = address(rm);
        }

        PredictionArena arena = new PredictionArena(roundManagerAddr, ctf, agentNFTAddr, admin, feedbackBaseURI);

        vm.stopBroadcast();

        console.log("");
        console.log("==========================================================");
        console.log("  DEPLOYMENT COMPLETE");
        console.log("==========================================================");
        console.log("");
        console.log("  AgentNFT:          ", agentNFTAddr);
        console.log("  RoundManager:      ", roundManagerAddr);
        console.log("  PredictionArena:   ", address(arena));
        console.log("");
        console.log("  CTF (external):    ", ctf);
        console.log("  Curator:           ", curator);
        console.log("  Admin:             ", admin);
        console.log("  Agent Base URI:    ", baseURI);
        console.log("  Feedback Base URI: ", feedbackBaseURI);
        console.log("==========================================================");
    }
}
