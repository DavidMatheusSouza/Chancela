// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {TrustAgentPolicyRegistry} from "../src/TrustAgentPolicyRegistry.sol";
import {ERC8004IdentityRegistry} from "../src/ERC8004IdentityRegistry.sol";

/**
 * Deploy TrustAgentPolicyRegistry, bound to an ERC-8004 Identity Registry.
 *
 * Mainnet (143): binds to the canonical registry. Never deploys its own.
 * Other chains: uses ERC8004_IDENTITY_REGISTRY if set, otherwise deploys the
 * minimal compatible registry -- because Monad testnet has no published
 * ERC-8004 deployment.
 */
contract Deploy is Script {
    address constant MAINNET_IDENTITY_REGISTRY = 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432;

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address identity = vm.envOr("ERC8004_IDENTITY_REGISTRY", address(0));

        vm.startBroadcast(pk);

        if (identity == address(0)) {
            if (block.chainid == 143) {
                identity = MAINNET_IDENTITY_REGISTRY;
                console.log("using canonical ERC-8004 registry");
            } else {
                identity = address(new ERC8004IdentityRegistry());
                console.log("deployed compatible ERC-8004 registry for this chain");
            }
        }

        TrustAgentPolicyRegistry registry = new TrustAgentPolicyRegistry(identity);
        vm.stopBroadcast();

        console.log("chainId          ", block.chainid);
        console.log("identityRegistry ", identity);
        console.log("policyRegistry   ", address(registry));

        vm.writeFile(
            string.concat("./deployments/", vm.toString(block.chainid), ".json"),
            string.concat(
                '{"chainId":', vm.toString(block.chainid),
                ',"identityRegistry":"', vm.toString(identity),
                '","policyRegistry":"', vm.toString(address(registry)),
                '"}'
            )
        );
    }
}
