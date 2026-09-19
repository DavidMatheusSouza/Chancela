// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {TrustAgentPolicyRegistry} from "../src/TrustAgentPolicyRegistry.sol";

/**
 * Deploy TrustAgentPolicyRegistry against the ERC-8004 Identity Registry.
 *
 *   Monad mainnet (chainId 143)  identity: 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432
 *   Monad testnet (chainId 10143) identity: set ERC8004_IDENTITY_REGISTRY explicitly.
 *
 * Usage:
 *   forge script script/Deploy.s.sol:Deploy --rpc-url monad_testnet --broadcast
 */
contract Deploy is Script {
    address constant MAINNET_IDENTITY_REGISTRY = 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432;

    function run() external {
        address identity = vm.envOr("ERC8004_IDENTITY_REGISTRY", address(0));
        if (identity == address(0)) {
            require(
                block.chainid == 143,
                "Set ERC8004_IDENTITY_REGISTRY: no known default for this chain"
            );
            identity = MAINNET_IDENTITY_REGISTRY;
        }

        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        vm.startBroadcast(pk);
        TrustAgentPolicyRegistry registry = new TrustAgentPolicyRegistry(identity);
        vm.stopBroadcast();

        console.log("chainId           ", block.chainid);
        console.log("identityRegistry  ", identity);
        console.log("policyRegistry    ", address(registry));

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
