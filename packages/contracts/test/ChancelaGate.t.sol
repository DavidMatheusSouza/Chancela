// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {TrustAgentPolicyRegistry as Reg} from "../src/TrustAgentPolicyRegistry.sol";
import {ChancelaGate as Gate} from "../src/ChancelaGate.sol";
import {ChancelaDemoVenue as Venue} from "../src/ChancelaDemoVenue.sol";
import {MockIdentityRegistry} from "./MockIdentityRegistry.sol";

contract ChancelaGateTest is Test {
    MockIdentityRegistry identity;
    Reg reg;
    Gate gate;
    Venue venue;

    address owner = address(0xA11CE);
    address stranger = address(0xBAD);
    address agent = address(0xDEFEA7);
    uint256 attestorKey = 0xA77E5;
    address attestor;

    uint256 constant TOKEN = 1;
    bytes32 constant POLICY_V1 = keccak256("policy-v1");
    bytes32 constant POLICY_V2 = keccak256("policy-v2");
    bytes32 constant DECISION = keccak256("decision-1");

    function setUp() public {
        vm.warp(1_800_000_000);
        attestor = vm.addr(attestorKey);
        identity = new MockIdentityRegistry();
        identity.mint(TOKEN, owner);
        reg = new Reg(address(identity));
        gate = new Gate(address(reg));
        venue = new Venue(gate);

        vm.startPrank(owner);
        reg.setAgentWallet(TOKEN, agent);
        reg.setAttestor(TOKEN, attestor);
        reg.anchorPolicy(TOKEN, 1, POLICY_V1);
        vm.stopPrank();
    }

    /* -------------------------------------------------------------- helpers */

    function _order(uint256 amount) internal view returns (bytes32) {
        return venue.orderHash("MON/USDC", "BUY", amount);
    }

    function _grant(bytes32 callHash) internal view returns (Gate.Grant memory) {
        return Gate.Grant({
            agentTokenId: TOKEN,
            target: address(venue),
            callHash: callHash,
            decisionHash: DECISION,
            policyHash: POLICY_V1,
            expiresAt: uint64(block.timestamp + 120)
        });
    }

    function _sign(Gate.Grant memory g, uint256 key) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, gate.grantDigest(g));
        return abi.encodePacked(r, s, v);
    }

    function _place(uint256 amount, Gate.Grant memory g, bytes memory sig)
        internal
        returns (uint256)
    {
        vm.prank(agent);
        return venue.placeOrder("MON/USDC", "BUY", amount, g, sig);
    }

    function _expectRefused(Gate.Reason reason) internal {
        vm.expectRevert(abi.encodeWithSelector(Gate.Refused.selector, reason));
    }

    /* ------------------------------------------------------------ happy path */

    function test_allowedOrderExecutesAndSpendsTheGrant() public {
        Gate.Grant memory g = _grant(_order(20_000));
        bytes memory sig = _sign(g, attestorKey);

        vm.expectEmit(true, true, true, true, address(gate));
        emit Gate.GrantConsumed(TOKEN, DECISION, address(venue), g.callHash, agent);
        vm.expectEmit(true, true, true, true, address(venue));
        emit Venue.OrderPlaced(1, agent, DECISION, "MON/USDC", "BUY", 20_000);

        assertEq(_place(20_000, g, sig), 1);
        assertTrue(gate.isUsed(DECISION));
        assertEq(venue.orderCount(), 1);
    }

    function test_checkAgreesBeforeAndAfter() public {
        Gate.Grant memory g = _grant(_order(20_000));
        bytes memory sig = _sign(g, attestorKey);
        assertEq(
            uint8(gate.check(g, sig, address(venue), agent, g.callHash)), uint8(Gate.Reason.OK)
        );
        _place(20_000, g, sig);
        assertEq(
            uint8(gate.check(g, sig, address(venue), agent, g.callHash)),
            uint8(Gate.Reason.ALREADY_USED)
        );
    }

    /* --------------------------------------------------- one test per refusal */

    function test_noGrantNoOrder() public {
        // The attack with nothing to show: a grant the attestor never signed.
        Gate.Grant memory g = _grant(_order(2_500_000));
        bytes memory forged = _sign(g, 0xBADBAD);
        _expectRefused(Gate.Reason.BAD_SIGNATURE);
        _place(2_500_000, g, forged);
    }

    function test_emptySignatureRefused() public {
        Gate.Grant memory g = _grant(_order(20_000));
        _expectRefused(Gate.Reason.BAD_SIGNATURE);
        _place(20_000, g, "");
    }

    function test_grantForSmallOrderCannotPayForLargeOne() public {
        // Allowed at $200, sent at $25,000: the venue hashes what it received.
        Gate.Grant memory g = _grant(_order(20_000));
        bytes memory sig = _sign(g, attestorKey);
        _expectRefused(Gate.Reason.CALL_MISMATCH);
        _place(2_500_000, g, sig);
    }

    function test_marketAndSideAreBound() public {
        Gate.Grant memory g = _grant(_order(20_000));
        bytes memory sig = _sign(g, attestorKey);
        vm.startPrank(agent);
        _expectRefused(Gate.Reason.CALL_MISMATCH);
        venue.placeOrder("WBTC/USDC", "BUY", 20_000, g, sig);
        _expectRefused(Gate.Reason.CALL_MISMATCH);
        venue.placeOrder("MON/USDC", "SELL", 20_000, g, sig);
        vm.stopPrank();
    }

    function test_grantCannotBeSpentTwice() public {
        Gate.Grant memory g = _grant(_order(20_000));
        bytes memory sig = _sign(g, attestorKey);
        _place(20_000, g, sig);
        _expectRefused(Gate.Reason.ALREADY_USED);
        _place(20_000, g, sig);
    }

    function test_expiredGrantRefused() public {
        Gate.Grant memory g = _grant(_order(20_000));
        bytes memory sig = _sign(g, attestorKey);
        vm.warp(g.expiresAt);
        _expectRefused(Gate.Reason.EXPIRED);
        _place(20_000, g, sig);
    }

    function test_onlyTheAgentWalletCanSpendIt() public {
        // A leaked grant is useless to whoever found it.
        Gate.Grant memory g = _grant(_order(20_000));
        bytes memory sig = _sign(g, attestorKey);
        vm.prank(stranger);
        _expectRefused(Gate.Reason.NOT_THE_AGENT);
        venue.placeOrder("MON/USDC", "BUY", 20_000, g, sig);
    }

    function test_noAgentWalletMeansNoOne() public {
        vm.prank(owner);
        reg.setAgentWallet(TOKEN, address(0));
        Gate.Grant memory g = _grant(_order(20_000));
        bytes memory sig = _sign(g, attestorKey);
        vm.prank(address(0));
        _expectRefused(Gate.Reason.NOT_THE_AGENT);
        venue.placeOrder("MON/USDC", "BUY", 20_000, g, sig);
    }

    function test_grantForAnotherVenueRefused() public {
        Venue other = new Venue(gate);
        Gate.Grant memory g = _grant(_order(20_000));
        bytes memory sig = _sign(g, attestorKey);
        vm.prank(agent);
        _expectRefused(Gate.Reason.WRONG_TARGET);
        other.placeOrder("MON/USDC", "BUY", 20_000, g, sig);
    }

    function test_agentCannotCallTheGateDirectly() public {
        // Consuming from outside the target would burn the grant without the call.
        Gate.Grant memory g = _grant(_order(20_000));
        bytes memory sig = _sign(g, attestorKey);
        vm.prank(agent);
        _expectRefused(Gate.Reason.WRONG_TARGET);
        gate.consume(g, sig, agent, g.callHash);
    }

    function test_attestorNotSetRefused() public {
        MockIdentityRegistry id2 = new MockIdentityRegistry();
        id2.mint(TOKEN, owner);
        Reg reg2 = new Reg(address(id2));
        Gate gate2 = new Gate(address(reg2));
        Venue venue2 = new Venue(gate2);
        vm.startPrank(owner);
        reg2.setAgentWallet(TOKEN, agent);
        reg2.anchorPolicy(TOKEN, 1, POLICY_V1);
        vm.stopPrank();

        Gate.Grant memory g = _grant(venue2.orderHash("MON/USDC", "BUY", 20_000));
        g.target = address(venue2);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(attestorKey, gate2.grantDigest(g));
        vm.prank(agent);
        _expectRefused(Gate.Reason.ATTESTOR_NOT_SET);
        venue2.placeOrder("MON/USDC", "BUY", 20_000, g, abi.encodePacked(r, s, v));
    }

    function test_malleableSignatureRefused() public {
        Gate.Grant memory g = _grant(_order(20_000));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(attestorKey, gate.grantDigest(g));
        uint256 n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
        bytes32 highS = bytes32(n - uint256(s));
        uint8 flipped = v == 27 ? 28 : 27;
        _expectRefused(Gate.Reason.BAD_SIGNATURE);
        _place(20_000, g, abi.encodePacked(r, highS, flipped));
    }

    /* ---------------------------- the owner's controls bind outstanding grants */

    function test_suspendingTheAgentKillsOutstandingGrants() public {
        Gate.Grant memory g = _grant(_order(20_000));
        bytes memory sig = _sign(g, attestorKey);
        vm.prank(owner);
        reg.suspendAgent(TOKEN, "stop");
        _expectRefused(Gate.Reason.AGENT_SUSPENDED);
        _place(20_000, g, sig);

        vm.prank(owner);
        reg.reactivateAgent(TOKEN);
        _place(20_000, g, sig);
    }

    function test_newPolicyVersionKillsGrantsFromTheOldOne() public {
        Gate.Grant memory g = _grant(_order(20_000));
        bytes memory sig = _sign(g, attestorKey);
        vm.prank(owner);
        reg.anchorPolicy(TOKEN, 2, POLICY_V2);
        _expectRefused(Gate.Reason.POLICY_CHANGED);
        _place(20_000, g, sig);
    }

    function test_rotatingTheAttestorKillsItsGrants() public {
        Gate.Grant memory g = _grant(_order(20_000));
        bytes memory sig = _sign(g, attestorKey);
        vm.prank(owner);
        reg.setAttestor(TOKEN, vm.addr(0xC0FFEE));
        _expectRefused(Gate.Reason.BAD_SIGNATURE);
        _place(20_000, g, sig);
    }

    function test_ownerRevokesOneGrant() public {
        Gate.Grant memory g = _grant(_order(20_000));
        bytes memory sig = _sign(g, attestorKey);
        vm.expectEmit(true, true, false, true, address(gate));
        emit Gate.GrantRevoked(TOKEN, DECISION, owner);
        vm.prank(owner);
        gate.revoke(TOKEN, DECISION);
        _expectRefused(Gate.Reason.ALREADY_USED);
        _place(20_000, g, sig);
    }

    function test_onlyTheCurrentOwnerRevokes() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Gate.NotAgentOwner.selector, TOKEN, stranger));
        gate.revoke(TOKEN, DECISION);

        // Control follows the ERC-8004 NFT.
        identity.mint(TOKEN, stranger);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(Gate.NotAgentOwner.selector, TOKEN, owner));
        gate.revoke(TOKEN, DECISION);
        vm.prank(stranger);
        gate.revoke(TOKEN, DECISION);
    }

    function test_revokingTwiceRefused() public {
        vm.startPrank(owner);
        gate.revoke(TOKEN, DECISION);
        _expectRefused(Gate.Reason.ALREADY_USED);
        gate.revoke(TOKEN, DECISION);
        vm.stopPrank();
    }

    /* ------------------------------------------- the attestor's side agrees */

    /// Same vectors as packages/shared/test/grant.test.ts: what the TypeScript
    /// attestor signs is what this contract checks.
    function test_vectorsMatchTheTypeScript() public {
        address gateAt = address(0xC4a7);
        address venueAt = address(0xBe0);
        deployCodeTo("ChancelaGate.sol:ChancelaGate", abi.encode(address(reg)), gateAt);
        deployCodeTo("ChancelaDemoVenue.sol:ChancelaDemoVenue", abi.encode(gateAt), venueAt);
        vm.chainId(10143);

        bytes32 callHash = Venue(venueAt).orderHash("MON/USDC", "BUY", 20_000);
        assertEq(callHash, 0xdab5f126dcb911760766a7fe5eaf2013b13ddce7dc77e9884a3a1d3310acaf00);

        Gate.Grant memory g = Gate.Grant({
            agentTokenId: 4,
            target: venueAt,
            callHash: callHash,
            decisionHash: bytes32(
                0x1111111111111111111111111111111111111111111111111111111111111111
            ),
            policyHash: bytes32(0x2222222222222222222222222222222222222222222222222222222222222222),
            expiresAt: 1_800_000_120
        });
        assertEq(
            Gate(gateAt).grantDigest(g),
            0xdc0fe68017520e2c41cac4ef6c75686615c7d57117d4e380925246a52d279c72
        );
    }

    /* ------------------------------------------------------------------ fuzz */

    /// Any change to any signed field, with the signature left as it was, is refused.
    function testFuzz_anyTamperedFieldIsRefused(uint8 field, uint256 noise) public {
        Gate.Grant memory g = _grant(_order(20_000));
        bytes memory sig = _sign(g, attestorKey);
        noise = bound(noise, 1, type(uint64).max - block.timestamp - 200);
        field = uint8(bound(field, 0, 3));
        if (field == 0) g.agentTokenId += noise;
        else if (field == 1) g.decisionHash = bytes32(uint256(g.decisionHash) ^ noise);
        else if (field == 2) g.expiresAt += uint64(noise);
        else g.policyHash = bytes32(uint256(g.policyHash) ^ noise);

        vm.prank(agent);
        vm.expectRevert();
        venue.placeOrder("MON/USDC", "BUY", 20_000, g, sig);
        assertEq(venue.orderCount(), 0);
    }

    /// Whatever amount the agent sends, only the one that was allowed goes through.
    function testFuzz_onlyTheAllowedAmountExecutes(uint256 allowed, uint256 sent) public {
        allowed = bound(allowed, 1, 1e15);
        sent = bound(sent, 1, 1e15);
        Gate.Grant memory g = _grant(_order(allowed));
        bytes memory sig = _sign(g, attestorKey);
        if (sent != allowed) _expectRefused(Gate.Reason.CALL_MISMATCH);
        _place(sent, g, sig);
        assertEq(venue.orderCount(), sent == allowed ? 1 : 0);
    }

    /// Signed by anyone but the registered attestor, nothing executes.
    function testFuzz_onlyTheRegisteredAttestorSigns(uint256 key) public {
        key = bound(key, 1, 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364140);
        vm.assume(key != attestorKey);
        Gate.Grant memory g = _grant(_order(20_000));
        bytes memory sig = _sign(g, key);
        _expectRefused(Gate.Reason.BAD_SIGNATURE);
        _place(20_000, g, sig);
    }
}
