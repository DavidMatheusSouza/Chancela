// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {TrustAgentPolicyRegistry as Reg} from "../src/TrustAgentPolicyRegistry.sol";
import {MockIdentityRegistry} from "./MockIdentityRegistry.sol";

contract TrustAgentPolicyRegistryTest is Test {
    MockIdentityRegistry identity;
    Reg reg;

    address owner = address(0xA11CE);
    address stranger = address(0xBAD);
    address attestor = address(0xA77E5);
    address agentWallet = address(0xDEFEA7);

    uint256 constant TOKEN = 1;
    bytes32 constant POLICY_V1 = keccak256("policy-v1");
    bytes32 constant POLICY_V2 = keccak256("policy-v2");
    bytes4 constant ACTION_TRANSFER = bytes4(keccak256("TRANSFER_FUNDS"));
    bytes4 constant ACTION_CREATE = bytes4(keccak256("CREATE_CUSTOMER"));

    function setUp() public {
        identity = new MockIdentityRegistry();
        identity.mint(TOKEN, owner);
        reg = new Reg(address(identity));

        vm.startPrank(owner);
        reg.setAgentWallet(TOKEN, agentWallet);
        reg.setAttestor(TOKEN, attestor);
        reg.anchorPolicy(TOKEN, 1, POLICY_V1);
        vm.stopPrank();
    }

    function _decision(bytes32 hash_, bytes32 policyHash) internal pure returns (Reg.DecisionInput memory) {
        return Reg.DecisionInput({
            agentTokenId: TOKEN,
            decisionHash: hash_,
            intentHash: keccak256("intent"),
            action: ACTION_CREATE,
            decision: Reg.Decision.ALLOW,
            risk: Reg.Risk.LOW,
            policyHash: policyHash
        });
    }

    /* ------------------------------------------------------------ ownership */

    function test_ownershipIsReadLiveFromIdentityRegistry() public {
        // Transferring the ERC-8004 NFT moves control with no migration step.
        identity.mint(TOKEN, stranger);
        vm.prank(stranger);
        reg.anchorPolicy(TOKEN, 2, POLICY_V2);

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(Reg.NotAgentOwner.selector, TOKEN, owner));
        reg.anchorPolicy(TOKEN, 3, POLICY_V2);
    }

    function test_strangerCannotAnchorPolicy() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Reg.NotAgentOwner.selector, TOKEN, stranger));
        reg.anchorPolicy(TOKEN, 2, POLICY_V2);
    }

    function test_strangerCannotSuspend() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Reg.NotAgentOwner.selector, TOKEN, stranger));
        reg.suspendAgent(TOKEN, "ABUSE");
    }

    /* --------------------------------------------------------------- policy */

    function test_anchorPolicyStoresBinding() public view {
        (bytes32 h, uint32 v,) = reg.activePolicy(TOKEN);
        assertEq(h, POLICY_V1);
        assertEq(v, 1);
    }

    function test_policyVersionMustIncrease() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(Reg.PolicyVersionNotIncreasing.selector, 1, 1));
        reg.anchorPolicy(TOKEN, 1, POLICY_V2);
    }

    function test_cannotReanchorOlderVersion() public {
        vm.startPrank(owner);
        reg.anchorPolicy(TOKEN, 5, POLICY_V2);
        vm.expectRevert(abi.encodeWithSelector(Reg.PolicyVersionNotIncreasing.selector, 5, 2));
        reg.anchorPolicy(TOKEN, 2, POLICY_V1);
        vm.stopPrank();
    }

    function test_emptyPolicyHashRejected() public {
        vm.prank(owner);
        vm.expectRevert(Reg.PolicyHashEmpty.selector);
        reg.anchorPolicy(TOKEN, 2, bytes32(0));
    }

    /* ------------------------------------------------------------- attestor */

    function test_attestorCannotBeAgentWallet() public {
        vm.prank(owner);
        vm.expectRevert(Reg.AttestorCannotBeAgentWallet.selector);
        reg.setAttestor(TOKEN, agentWallet);
    }

    function test_agentWalletCannotBecomeAttestorByTheBackDoor() public {
        vm.prank(owner);
        vm.expectRevert(Reg.AttestorCannotBeAgentWallet.selector);
        reg.setAgentWallet(TOKEN, attestor);
    }

    function test_attestorCannotBeZero() public {
        vm.prank(owner);
        vm.expectRevert(Reg.AttestorCannotBeZero.selector);
        reg.setAttestor(TOKEN, address(0));
    }

    function test_onlyAttestorCanRecord() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Reg.NotAttestor.selector, TOKEN, stranger));
        reg.recordDecision(_decision(keccak256("d1"), POLICY_V1));
    }

    function test_ownerCannotForgeADecision() public {
        // Even the owner cannot write decisions: only the attestation key can.
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(Reg.NotAttestor.selector, TOKEN, owner));
        reg.recordDecision(_decision(keccak256("d1"), POLICY_V1));
    }

    /* ------------------------------------------------------------ decisions */

    function test_recordDecisionEmitsAndCounts() public {
        vm.prank(attestor);
        vm.expectEmit(true, true, true, true);
        emit Reg.DecisionRecorded(
            TOKEN,
            keccak256("d1"),
            ACTION_CREATE,
            Reg.Decision.ALLOW,
            Reg.Risk.LOW,
            keccak256("intent"),
            POLICY_V1,
            uint64(block.timestamp)
        );
        reg.recordDecision(_decision(keccak256("d1"), POLICY_V1));

        assertTrue(reg.isDecisionRecorded(keccak256("d1")));
        assertEq(reg.decisionCount(TOKEN), 1);
    }

    function test_denialsAreRecordedToo() public {
        Reg.DecisionInput memory d = _decision(keccak256("deny1"), POLICY_V1);
        d.decision = Reg.Decision.DENY;
        d.risk = Reg.Risk.CRITICAL;
        d.action = ACTION_TRANSFER;

        vm.prank(attestor);
        reg.recordDecision(d);
        assertTrue(reg.isDecisionRecorded(keccak256("deny1")));
    }

    function test_decisionReplayRejected() public {
        vm.startPrank(attestor);
        reg.recordDecision(_decision(keccak256("d1"), POLICY_V1));
        vm.expectRevert(
            abi.encodeWithSelector(Reg.DecisionAlreadyRecorded.selector, keccak256("d1"))
        );
        reg.recordDecision(_decision(keccak256("d1"), POLICY_V1));
        vm.stopPrank();
    }

    function test_decisionMustNameTheLivePolicy() public {
        vm.prank(attestor);
        vm.expectRevert(
            abi.encodeWithSelector(Reg.PolicyHashMismatch.selector, POLICY_V1, POLICY_V2)
        );
        reg.recordDecision(_decision(keccak256("d1"), POLICY_V2));
    }

    function test_staleDecisionRejectedAfterPolicyChange() public {
        // A decision computed under v1 cannot be written once v2 is live.
        vm.prank(owner);
        reg.anchorPolicy(TOKEN, 2, POLICY_V2);

        vm.prank(attestor);
        vm.expectRevert(
            abi.encodeWithSelector(Reg.PolicyHashMismatch.selector, POLICY_V2, POLICY_V1)
        );
        reg.recordDecision(_decision(keccak256("d1"), POLICY_V1));
    }

    function test_cannotRecordWithoutAnchoredPolicy() public {
        identity.mint(2, owner);
        vm.startPrank(owner);
        reg.setAttestor(2, attestor);
        vm.stopPrank();

        Reg.DecisionInput memory d = _decision(keccak256("d2"), POLICY_V1);
        d.agentTokenId = 2;

        vm.prank(attestor);
        vm.expectRevert(abi.encodeWithSelector(Reg.NoPolicyAnchored.selector, uint256(2)));
        reg.recordDecision(d);
    }

    function test_suspendedAgentCannotRecord() public {
        vm.prank(owner);
        reg.suspendAgent(TOKEN, "ABUSE");

        vm.prank(attestor);
        vm.expectRevert(abi.encodeWithSelector(Reg.AgentIsSuspended.selector, TOKEN));
        reg.recordDecision(_decision(keccak256("d1"), POLICY_V1));
    }

    function test_reactivateRestoresRecording() public {
        vm.startPrank(owner);
        reg.suspendAgent(TOKEN, "ABUSE");
        reg.reactivateAgent(TOKEN);
        vm.stopPrank();

        vm.prank(attestor);
        reg.recordDecision(_decision(keccak256("d1"), POLICY_V1));
        assertEq(reg.decisionCount(TOKEN), 1);
    }

    /* ---------------------------------------------------------------- batch */

    function test_batchRecords() public {
        Reg.DecisionInput[] memory items = new Reg.DecisionInput[](3);
        items[0] = _decision(keccak256("b1"), POLICY_V1);
        items[1] = _decision(keccak256("b2"), POLICY_V1);
        items[2] = _decision(keccak256("b3"), POLICY_V1);

        vm.prank(attestor);
        reg.recordDecisionBatch(items);
        assertEq(reg.decisionCount(TOKEN), 3);
    }

    function test_batchIsAtomicOnDuplicate() public {
        Reg.DecisionInput[] memory items = new Reg.DecisionInput[](2);
        items[0] = _decision(keccak256("b1"), POLICY_V1);
        items[1] = _decision(keccak256("b1"), POLICY_V1);

        vm.prank(attestor);
        vm.expectRevert(
            abi.encodeWithSelector(Reg.DecisionAlreadyRecorded.selector, keccak256("b1"))
        );
        reg.recordDecisionBatch(items);
        assertEq(reg.decisionCount(TOKEN), 0);
    }

    function test_emptyBatchRejected() public {
        Reg.DecisionInput[] memory items = new Reg.DecisionInput[](0);
        vm.prank(attestor);
        vm.expectRevert(Reg.EmptyBatch.selector);
        reg.recordDecisionBatch(items);
    }

    /* ---------------------------------------------------------------- fuzz */

    function testFuzz_onlyAttestorEverRecords(address caller) public {
        vm.assume(caller != attestor);
        vm.prank(caller);
        vm.expectRevert();
        reg.recordDecision(_decision(keccak256("fz"), POLICY_V1));
    }

    function testFuzz_policyVersionMonotonic(uint32 a, uint32 b) public {
        vm.assume(a > 1 && b > 1);
        vm.assume(a < b);
        vm.startPrank(owner);
        reg.anchorPolicy(TOKEN, b, POLICY_V2);
        vm.expectRevert(abi.encodeWithSelector(Reg.PolicyVersionNotIncreasing.selector, b, a));
        reg.anchorPolicy(TOKEN, a, POLICY_V1);
        vm.stopPrank();
    }

    function testFuzz_decisionHashRecordedExactlyOnce(bytes32 h) public {
        vm.assume(h != bytes32(0));
        vm.startPrank(attestor);
        reg.recordDecision(_decision(h, POLICY_V1));
        vm.expectRevert(abi.encodeWithSelector(Reg.DecisionAlreadyRecorded.selector, h));
        reg.recordDecision(_decision(h, POLICY_V1));
        vm.stopPrank();
    }
}
