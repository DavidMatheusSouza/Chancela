// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {TrustAgentPolicyRegistry as Reg} from "../src/TrustAgentPolicyRegistry.sol";
import {ChancelaGate as Gate} from "../src/ChancelaGate.sol";
import {ChancelaDemoVenue as Venue} from "../src/ChancelaDemoVenue.sol";

/// The ERC-8004 Identity Registry actually deployed on Monad mainnet (an
/// upgradeable ERC-721). Only the calls the test needs.
interface IOfficialIdentity {
    function register(string calldata agentURI) external returns (uint256 agentId);
    function ownerOf(uint256 tokenId) external view returns (address);
    function transferFrom(address from, address to, uint256 tokenId) external;
}

/// Chancela against the official ERC-8004 registry, on a fork of Monad mainnet.
///
/// Every other test uses MockIdentityRegistry. This one registers an agent in
/// the registry the ecosystem uses, points the policy registry and the gate at
/// it, and checks that ownership there is what governs everything here: who
/// may set the policy, whose attestor counts, and that selling the identity
/// hands over control. Moving to mainnet is then a deployment, not a port.
///
///   MONAD_MAINNET_RPC_URL=https://rpc.monad.xyz forge test --network monad --match-path test/OfficialERC8004.fork.t.sol -vv
///
/// Skipped when the variable is unset, so CI stays offline.
contract OfficialERC8004ForkTest is Test {
    IOfficialIdentity constant IDENTITY = IOfficialIdentity(0x8004A169FB4a3325136EB29fA0ceB6D2e539a432);

    Reg reg;
    Gate gate;
    Venue venue;
    uint256 token;

    address owner = makeAddr("owner");
    address buyer = makeAddr("buyer");
    address agent = makeAddr("agent");
    uint256 attestorKey = 0xA77E5;
    bytes32 constant POLICY_V1 = keccak256("policy-v1");

    function setUp() public {
        string memory rpc = vm.envOr("MONAD_MAINNET_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true, "set MONAD_MAINNET_RPC_URL to run against the official registry");
            return;
        }
        vm.createSelectFork(rpc);
        assertEq(block.chainid, 143, "not Monad mainnet");
        assertGt(address(IDENTITY).code.length, 0, "no ERC-8004 registry at the official address");

        vm.prank(owner);
        token = IDENTITY.register("https://chancela.xyz/agents/fork-test.json");
        assertEq(IDENTITY.ownerOf(token), owner);

        reg = new Reg(address(IDENTITY));
        gate = new Gate(address(reg));
        venue = new Venue(gate);

        vm.startPrank(owner);
        reg.setAgentWallet(token, agent);
        reg.setAttestor(token, vm.addr(attestorKey));
        reg.anchorPolicy(token, 1, POLICY_V1);
        vm.stopPrank();
    }

    function _grant(uint256 amount) internal view returns (Gate.Grant memory) {
        return Gate.Grant({
            agentTokenId: token,
            target: address(venue),
            callHash: venue.orderHash("MON/USDC", "BUY", amount),
            decisionHash: keccak256(abi.encode("decision", amount)),
            policyHash: POLICY_V1,
            expiresAt: uint64(block.timestamp + 60)
        });
    }

    function _sign(Gate.Grant memory g, uint256 key) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, gate.grantDigest(g));
        return abi.encodePacked(r, s, v);
    }

    function test_officialIdentityOwnerSetsThePolicy() public {
        (bytes32 hash, uint32 version,) = reg.activePolicy(token);
        assertEq(version, 1);
        assertEq(hash, POLICY_V1);
        assertEq(reg.attestorOf(token), vm.addr(attestorKey));
        assertEq(reg.agentWalletOf(token), agent);
    }

    function test_someoneElseCannot() public {
        vm.startPrank(buyer);
        vm.expectRevert(abi.encodeWithSelector(Reg.NotAgentOwner.selector, token, buyer));
        reg.setAttestor(token, buyer);
        vm.expectRevert(abi.encodeWithSelector(Reg.NotAgentOwner.selector, token, buyer));
        reg.anchorPolicy(token, 2, keccak256("no limits"));
        vm.stopPrank();
    }

    function test_gateExecutesAllowedAndRevertsForged() public {
        Gate.Grant memory ok = _grant(20_000);
        bytes memory sig = _sign(ok, attestorKey);
        vm.prank(agent);
        assertEq(venue.placeOrder("MON/USDC", "BUY", 20_000, ok, sig), 1);

        Gate.Grant memory big = _grant(2_500_000);
        bytes memory forged = _sign(big, 0xBADBAD);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(Gate.Refused.selector, Gate.Reason.BAD_SIGNATURE));
        venue.placeOrder("MON/USDC", "BUY", 2_500_000, big, forged);
    }

    function test_transferringTheIdentityTransfersControl() public {
        vm.prank(owner);
        IDENTITY.transferFrom(owner, buyer, token);

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(Reg.NotAgentOwner.selector, token, owner));
        reg.anchorPolicy(token, 2, keccak256("policy-v2"));

        vm.prank(buyer);
        reg.anchorPolicy(token, 2, keccak256("policy-v2"));
        (, uint32 version,) = reg.activePolicy(token);
        assertEq(version, 2);

        // The new owner's policy change voids grants signed under the old one.
        Gate.Grant memory stale = _grant(20_000);
        bytes memory sig = _sign(stale, attestorKey);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(Gate.Refused.selector, Gate.Reason.POLICY_CHANGED));
        venue.placeOrder("MON/USDC", "BUY", 20_000, stale, sig);
    }
}
