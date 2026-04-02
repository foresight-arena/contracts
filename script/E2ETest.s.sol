// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import {IRoundManager} from "../src/interfaces/IRoundManager.sol";
import {RoundManager} from "../src/RoundManager.sol";
import {PredictionArena} from "../src/PredictionArena.sol";
import {IPredictionArena} from "../src/interfaces/IPredictionArena.sol";

import {MockConditionalTokens} from "../test/mocks/MockConditionalTokens.sol";

/// @dev RoundManager with short windows for testnet E2E testing.
contract TestnetRoundManager is RoundManager {
    constructor(address _curator, address _admin) RoundManager(_curator, _admin) {}

    function createTestRound(
        bytes32[] calldata conditionIds,
        uint64 commitDeadline,
        uint64 revealStart,
        uint64 revealDeadline,
        uint16 minResolvedMarkets
    ) external returns (uint256 roundId) {
        require(msg.sender == curator, "Only curator");
        require(conditionIds.length >= 1 && conditionIds.length <= 20, "Invalid market count");
        require(commitDeadline > uint64(block.timestamp), "Commit deadline in past");
        require(revealStart > commitDeadline, "Reveal start before commit");
        require(revealDeadline > revealStart, "Reveal before start");

        roundId = ++currentRoundId;
        IRoundManager.Round storage r = _rounds[roundId];
        r.conditionIds = conditionIds;
        r.commitDeadline = commitDeadline;
        r.revealStart = revealStart;
        r.revealDeadline = revealDeadline;
        r.minResolvedMarkets = minResolvedMarkets;

        emit RoundCreated(roundId, conditionIds, commitDeadline, revealStart, revealDeadline, minResolvedMarkets);
    }
}

/// @dev Step 1: Deploy contracts, create round, two agents commit.
contract E2EStep1 is Script {
    MockConditionalTokens mockCtf = MockConditionalTokens(0x4aF09f4A542ceD3E3957fD3A11590144b1008dD1);

    function run() external {
        address deployer = msg.sender;
        console.log("Agent A (deployer):", deployer);

        vm.startBroadcast();

        // Deploy fresh contracts with short windows
        TestnetRoundManager rm = new TestnetRoundManager(deployer, deployer);
        console.log("TestnetRoundManager:", address(rm));

        PredictionArena arena = new PredictionArena(address(rm), address(mockCtf), deployer);
        console.log("PredictionArena:", address(arena));

        // Fund agent B for gas
        payable(vm.addr(uint256(keccak256("foresight_e2e_agent_b")))).transfer(0.02 ether);

        // Create round: 3 markets, 3min commit window, 10min reveal window
        bytes32[] memory cids = new bytes32[](3);
        cids[0] = keccak256("e2e_market_1");
        cids[1] = keccak256("e2e_market_2");
        cids[2] = keccak256("e2e_market_3");

        uint64 commitDeadline = uint64(block.timestamp) + 180;
        uint64 revealStart = commitDeadline + 10; // 10s oracle buffer for testnet
        uint64 revealDeadline = revealStart + 600;
        uint256 roundId = rm.createTestRound(cids, commitDeadline, revealStart, revealDeadline, 1);
        console.log("Round ID:", roundId);
        console.log("Commit deadline:", commitDeadline);

        // Agent A predictions: 8500, 7200, 1500
        uint16[] memory predsA = new uint16[](3);
        predsA[0] = 8500;
        predsA[1] = 7200;
        predsA[2] = 1500;
        bytes32 saltA = keccak256("salt_agent_a");
        bytes32 hashA;
        {
            bytes memory packedA = abi.encodePacked(roundId);
            for (uint256 i = 0; i < predsA.length; i++) {
                packedA = abi.encodePacked(packedA, predsA[i]);
            }
            hashA = keccak256(abi.encodePacked(packedA, saltA));
        }
        arena.commit(roundId, hashA);
        console.log("Agent A committed");

        vm.stopBroadcast();

        // Agent B commits from their own address
        {
            uint256 agentBKey = uint256(keccak256("foresight_e2e_agent_b"));
            uint16[] memory predsB = new uint16[](3);
            predsB[0] = 6000;
            predsB[1] = 4000;
            predsB[2] = 5500;
            bytes32 saltB = keccak256("salt_agent_b");
            bytes memory packedB = abi.encodePacked(roundId);
            for (uint256 i = 0; i < predsB.length; i++) {
                packedB = abi.encodePacked(packedB, predsB[i]);
            }
            bytes32 hashB = keccak256(abi.encodePacked(packedB, saltB));

            vm.startBroadcast(agentBKey);
            arena.commit(roundId, hashB);
            console.log("Agent B committed");
            vm.stopBroadcast();
        }

        console.log("");
        console.log("=== STEP 1 COMPLETE ===");
        console.log("Wait ~3 minutes for commit deadline, then run E2EStep2");
        console.log("ROUND_MANAGER:", address(rm));
        console.log("ARENA:", address(arena));
    }
}

/// @dev Step 2: Post benchmarks, set oracle payouts, agents reveal, verify scores.
///      Pass ROUND_MANAGER and ARENA as env vars.
contract E2EStep2 is Script {
    MockConditionalTokens mockCtf = MockConditionalTokens(0x4aF09f4A542ceD3E3957fD3A11590144b1008dD1);

    function run() external {
        address rmAddr = vm.envAddress("ROUND_MANAGER");
        address arenaAddr = vm.envAddress("ARENA");
        TestnetRoundManager rm = TestnetRoundManager(rmAddr);
        PredictionArena arena = PredictionArena(arenaAddr);
        uint256 roundId = 1;

        uint256 agentBKey = uint256(keccak256("foresight_e2e_agent_b"));
        address agentB = vm.addr(agentBKey);

        // Condition IDs (must match step 1)
        bytes32[] memory cids = new bytes32[](3);
        cids[0] = keccak256("e2e_market_1");
        cids[1] = keccak256("e2e_market_2");
        cids[2] = keccak256("e2e_market_3");

        // --- Step 3: Curator posts benchmark prices ---
        vm.startBroadcast();

        uint16[] memory benchmarks = new uint16[](3);
        benchmarks[0] = 7000; // market 1: 70%
        benchmarks[1] = 5000; // market 2: 50%
        benchmarks[2] = 3000; // market 3: 30%
        rm.postBenchmarkPrices(roundId, benchmarks);
        console.log("Benchmarks posted: [7000, 5000, 3000]");

        // --- Step 4: Push resolutions to mock oracle ---
        // Market 1: YES wins [1,0], Market 2: NO wins [0,1], Market 3: YES wins [1,0]
        uint256[] memory yes = new uint256[](2);
        yes[0] = 1;
        yes[1] = 0;
        uint256[] memory no = new uint256[](2);
        no[0] = 0;
        no[1] = 1;

        mockCtf.setPayouts(cids[0], yes); // market 1 → YES
        mockCtf.setPayouts(cids[1], no); // market 2 → NO
        mockCtf.setPayouts(cids[2], yes); // market 3 → YES
        console.log("Oracle payouts set: [YES, NO, YES]");
        console.log("Outcomes in bp: [10000, 0, 10000]");

        vm.stopBroadcast();

        // --- Step 5: Wait for reveal start, then agents reveal ---
        IRoundManager.Round memory r = rm.getRound(roundId);
        console.log("Current time:", block.timestamp);
        console.log("Reveal starts:", r.revealStart);
        require(block.timestamp >= r.revealStart, "Reveal phase not started yet -- wait a few more seconds");

        // Agent A reveals
        uint16[] memory predsA = new uint16[](3);
        predsA[0] = 8500;
        predsA[1] = 7200;
        predsA[2] = 1500;
        bytes32 saltA = keccak256("salt_agent_a");

        vm.startBroadcast();
        arena.reveal(roundId, predsA, saltA);
        console.log("Agent A revealed: [8500, 7200, 1500]");
        vm.stopBroadcast();

        // Agent B reveals
        uint16[] memory predsB = new uint16[](3);
        predsB[0] = 6000;
        predsB[1] = 4000;
        predsB[2] = 5500;
        bytes32 saltB = keccak256("salt_agent_b");

        vm.startBroadcast(agentBKey);
        arena.reveal(roundId, predsB, saltB);
        console.log("Agent B revealed: [6000, 4000, 5500]");
        vm.stopBroadcast();

        // --- Step 6: Verify scores ---
        address deployer = vm.envAddress("DEPLOYER");
        _verifyScores(arena, roundId, deployer, agentB);
    }

    /// @dev Offchain score calculations:
    /// Outcomes: market1=10000(YES), market2=0(NO), market3=10000(YES)
    /// Benchmarks: [7000, 5000, 3000]
    ///
    /// Agent A [8500, 7200, 1500]:
    ///   m1: diff=-1500 brier=2250000   benchDiff=-3000 baseline=9000000  alpha=6750000
    ///   m2: diff=7200  brier=51840000  benchDiff=5000  baseline=25000000 alpha=-26840000
    ///   m3: diff=-8500 brier=72250000  benchDiff=-7000 baseline=49000000 alpha=-23250000
    ///   total: brier=126340000 alpha=-43340000 → avg: 42113333, -14446666
    ///
    /// Agent B [6000, 4000, 5500]:
    ///   m1: diff=-4000 brier=16000000  benchDiff=-3000 baseline=9000000  alpha=-7000000
    ///   m2: diff=4000  brier=16000000  benchDiff=5000  baseline=25000000 alpha=9000000
    ///   m3: diff=-4500 brier=20250000  benchDiff=-7000 baseline=49000000 alpha=28750000
    ///   total: brier=52250000 alpha=30750000 → avg: 17416666, 10250000
    function _verifyScores(PredictionArena arena, uint256 roundId, address agentA, address agentB) internal view {
        IPredictionArena.Score memory scoreA = arena.getScore(roundId, agentA);
        IPredictionArena.Score memory scoreB = arena.getScore(roundId, agentB);

        console.log("");
        console.log("=== SCORE VERIFICATION ===");
        console.log("Agent A on-chain  brier:", scoreA.brierScore);
        console.log("Agent A expected  brier: 42113333");
        console.log("Agent A on-chain  alpha:", scoreA.alphaScore);
        console.log("Agent A expected  alpha: -14446666");
        console.log("Agent A scored markets:", scoreA.scoredMarkets);
        console.log("");
        console.log("Agent B on-chain  brier:", scoreB.brierScore);
        console.log("Agent B expected  brier: 17416666");
        console.log("Agent B on-chain  alpha:", scoreB.alphaScore);
        console.log("Agent B expected  alpha: 10250000");
        console.log("Agent B scored markets:", scoreB.scoredMarkets);

        require(scoreA.brierScore == 42113333, "Agent A brier MISMATCH");
        require(scoreA.alphaScore == -14446666, "Agent A alpha MISMATCH");
        require(scoreA.scoredMarkets == 3, "Agent A scored markets MISMATCH");
        require(scoreB.brierScore == 17416666, "Agent B brier MISMATCH");
        require(scoreB.alphaScore == 10250000, "Agent B alpha MISMATCH");
        require(scoreB.scoredMarkets == 3, "Agent B scored markets MISMATCH");

        console.log("");
        console.log("ALL SCORES MATCH! E2E test passed.");
    }
}
