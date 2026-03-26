// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import {PredictionArena} from "../src/PredictionArena.sol";
import {IPredictionArena} from "../src/interfaces/IPredictionArena.sol";
import {IRoundManager} from "../src/interfaces/IRoundManager.sol";

contract PostAndReveal is Script {
    address constant ARENA = 0xB9770aAf58358C5b8c3807d281A9DF0E6590EE09;
    address constant ROUND_MANAGER = 0x87C250dE51750283f222173fDE2988321aF1Fa7F;

    function run() external {
        uint256 roundId = vm.envUint("ROUND_ID");
        uint256 agentKey = vm.envUint("PRIVATE_KEY_AGENT1");
        address agent = vm.addr(agentKey);

        // Predictions and salt — must match what was committed
        uint16[] memory preds = new uint16[](2);
        preds[0] = 7000; // BTC
        preds[1] = 4500; // XRP
        bytes32 salt = 0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef;

        // Verify hash locally first
        bytes32 expectedHash = keccak256(abi.encodePacked(roundId, preds, salt));
        IPredictionArena.Commitment memory c = PredictionArena(ARENA).getCommitment(roundId, agent);
        console.log("Agent:", agent);
        console.log("Stored hash: ");
        console.logBytes32(c.commitHash);
        console.log("Computed hash:");
        console.logBytes32(expectedHash);
        console.log("Match:", c.commitHash == expectedHash);

        // Debug: show packed encoding
        bytes memory packed = abi.encodePacked(roundId, preds, salt);
        console.log("Packed length:", packed.length);
        console.logBytes(packed);

        require(c.commitHash == expectedHash, "Hashes don't match locally - abort");

        // Post benchmarks (curator)
        vm.startBroadcast();
        uint16[] memory benchmarks = new uint16[](2);
        benchmarks[0] = 35;
        benchmarks[1] = 140;

        IRoundManager.Round memory r = IRoundManager(ROUND_MANAGER).getRound(roundId);
        if (!r.benchmarksPosted) {
            IRoundManager(ROUND_MANAGER).postBenchmarkPrices(roundId, benchmarks);
            console.log("Benchmarks posted");
        } else {
            console.log("Benchmarks already posted");
        }
        vm.stopBroadcast();

        // Reveal (agent)
        vm.startBroadcast(agentKey);
        PredictionArena(ARENA).reveal(roundId, preds, salt);
        console.log("Revealed!");
        vm.stopBroadcast();

        // Check score
        IPredictionArena.Score memory score = PredictionArena(ARENA).getScore(roundId, agent);
        console.log("Brier score:", score.brierScore);
        console.log("Alpha score:", score.alphaScore);
        console.log("Scored markets:", score.scoredMarkets);
        console.log("Total markets:", score.totalMarkets);
    }
}
