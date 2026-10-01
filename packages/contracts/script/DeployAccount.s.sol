// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {ChancelaGate} from "../src/ChancelaGate.sol";
import {ChancelaAccount} from "../src/ChancelaAccount.sol";

/// @notice Deploys a ChancelaAccount for one agent over an existing gate. No
///         owner or admin: the agent's ERC-8004 holder is the only one who can
///         withdraw, and only grants for that agent move anything.
///   GATE_ADDRESS     the deployed ChancelaGate
///   ACCOUNT_AGENT_ID the agent's ERC-8004 token id (TA-LIVE is 4 on testnet)
contract DeployAccount is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        ChancelaGate gate = ChancelaGate(vm.envAddress("GATE_ADDRESS"));
        uint256 agent = vm.envUint("ACCOUNT_AGENT_ID");

        vm.startBroadcast(pk);
        ChancelaAccount account = new ChancelaAccount(gate, agent);
        vm.stopBroadcast();

        console.log("chainId ", block.chainid);
        console.log("gate    ", address(gate));
        console.log("agent   ", agent);
        console.log("account ", address(account));
    }
}
