// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {ChancelaApprovals} from "../src/ChancelaApprovals.sol";

/// @notice Deploys ChancelaApprovals next to an existing identity registry.
///   ERC8004_IDENTITY_REGISTRY  the registry whose owners may set approvers
///   APPROVALS_RP_ID            the site's hostname, e.g. chancela.xyz
contract DeployApprovals is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address identity = vm.envAddress("ERC8004_IDENTITY_REGISTRY");
        string memory rpId = vm.envString("APPROVALS_RP_ID");

        vm.startBroadcast(pk);
        ChancelaApprovals approvals = new ChancelaApprovals(identity, sha256(bytes(rpId)));
        vm.stopBroadcast();

        console.log("chainId          ", block.chainid);
        console.log("identityRegistry ", identity);
        console.log("rpId             ", rpId);
        console.log("approvals        ", address(approvals));
    }
}
