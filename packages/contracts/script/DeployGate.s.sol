// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {ChancelaGate} from "../src/ChancelaGate.sol";
import {ChancelaDemoVenue} from "../src/ChancelaDemoVenue.sol";

/// @notice Deploys ChancelaGate over the existing policy registry, and the demo
///         venue that only takes orders through it. Neither has an owner or an
///         admin function; the registry is read, never written.
///   POLICY_REGISTRY_ADDRESS  the deployed TrustAgentPolicyRegistry
contract DeployGate is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address registry = vm.envAddress("POLICY_REGISTRY_ADDRESS");

        vm.startBroadcast(pk);
        ChancelaGate gate = new ChancelaGate(registry);
        ChancelaDemoVenue venue = new ChancelaDemoVenue(gate);
        vm.stopBroadcast();

        console.log("chainId        ", block.chainid);
        console.log("policyRegistry ", registry);
        console.log("gate           ", address(gate));
        console.log("demoVenue      ", address(venue));
    }
}
