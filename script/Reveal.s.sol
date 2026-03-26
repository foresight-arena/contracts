// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import {PredictionArena} from "../src/PredictionArena.sol";
import {IPredictionArena} from "../src/interfaces/IPredictionArena.sol";
import {IRoundManager} from "../src/interfaces/IRoundManager.sol";

contract PostAndReveal is Script {
    address constant ARENA = 0x5D0aFAb396CA23d25e2Bd703c9736aC095be8eB6;
    address constant ROUND_MANAGER = 0xa2303C1FbFD8dD556355eE9E33Bb899759907d78;

    function run() external {
        uint256 roundId = vm.envUint("ROUND_ID");
        uint256 agentKey = vm.envUint("PRIVATE_KEY_AGENT1");
        address agent = vm.addr(agentKey);

        // Predictions and salt - must match what was committed
        uint16[] memory preds = new uint16[](2);
        preds[0] = 7000; // BTC
        preds[1] = 4500; // XRP
        bytes32 salt = 0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef;

        // Compute hash with tight 2-byte packing (matches contract)
        bytes memory packed = abi.encodePacked(roundId);
        for (uint256 i = 0; i < preds.length; i++) {
            packed = abi.encodePacked(packed, preds[i]);
        }
        bytes32 expectedHash = keccak256(abi.encodePacked(packed, salt));

        IPredictionArena.Commitment memory c = PredictionArena(ARENA).getCommitment(roundId, agent);
        console.log("Agent:", agent);
        console.log("Stored hash: ");
        console.logBytes32(c.commitHash);
        console.log("Computed hash:");
        console.logBytes32(expectedHash);
        console.log("Match:", c.commitHash == expectedHash);
        console.log("Packed length:", packed.length);

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
