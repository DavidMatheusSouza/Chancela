// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {ChancelaApprovals as Approvals} from "../src/ChancelaApprovals.sol";
import {MockIdentityRegistry} from "./MockIdentityRegistry.sol";

contract ChancelaApprovalsTest is Test {
    MockIdentityRegistry identity;
    Approvals approvals;

    address owner = address(0xA11CE);
    address stranger = address(0xBAD);
    uint256 constant TOKEN = 1;

    uint256 constant PASSKEY = 0xC0FFEE;
    uint256 constant OTHER_PASSKEY = 0xBEEF;
    // Order of the P-256 group, to put a signature in low-s form.
    uint256 constant N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551;

    bytes32 constant RP = sha256("chancela.xyz");
    bytes32 constant DECISION = keccak256("decision-1");

    function setUp() public {
        identity = new MockIdentityRegistry();
        identity.mint(TOKEN, owner);
        approvals = new Approvals(address(identity), RP);
        (uint256 x, uint256 y) = vm.publicKeyP256(PASSKEY);
        vm.prank(owner);
        approvals.setApprover(TOKEN, bytes32(x), bytes32(y));
    }

    /* ------------------------------------------------------------- helpers */

    function _clientData(string memory typ, bytes32 challenge) internal pure returns (string memory) {
        return string(
            abi.encodePacked(
                '{"type":"',
                typ,
                '","challenge":"',
                Base64.encodeURL(abi.encodePacked(challenge)),
                '","origin":"https://chancela.xyz","crossOrigin":false}'
            )
        );
    }

    function _authData(bytes32 rp, bytes1 flags) internal pure returns (bytes memory) {
        return abi.encodePacked(rp, flags, uint32(7));
    }

    function _assertion(uint256 key, bytes memory auth, string memory client, string memory typ)
        internal
        pure
        returns (Approvals.Assertion memory a)
    {
        bytes32 message = sha256(abi.encodePacked(auth, sha256(bytes(client))));
        (bytes32 r, bytes32 s) = vm.signP256(key, message);
        if (uint256(s) > N / 2) s = bytes32(N - uint256(s));
        a = Approvals.Assertion({
            authenticatorData: auth,
            clientDataJSON: client,
            typeIndex: 1,
            challengeIndex: 1 + bytes('"type":"').length + bytes(typ).length + 2,
            r: r,
            s: s
        });
    }

    function _good(bytes32 decision) internal pure returns (Approvals.Assertion memory) {
        return _assertion(PASSKEY, _authData(RP, 0x05), _clientData("webauthn.get", decision), "webauthn.get");
    }

    /* --------------------------------------------------------------- tests */

    function test_passkeyApprovalIsVerifiedAndRecorded() public {
        assertEq(approvals.approvedAt(DECISION), 0);
        vm.warp(1_800_000_000);
        vm.prank(stranger); // anyone may submit: the signature carries the authority
        approvals.recordApproval(TOKEN, DECISION, _good(DECISION));
        assertEq(approvals.approvedAt(DECISION), 1_800_000_000);
    }

    function test_approvalCannotBeMovedToAnotherDecision() public {
        Approvals.Assertion memory a = _good(DECISION);
        vm.expectRevert(Approvals.ChallengeMismatch.selector);
        approvals.recordApproval(TOKEN, keccak256("decision-2"), a);
    }

    function test_approvalCannotBeRecordedTwice() public {
        Approvals.Assertion memory a = _good(DECISION);
        approvals.recordApproval(TOKEN, DECISION, a);
        vm.expectRevert(abi.encodeWithSelector(Approvals.AlreadyApproved.selector, DECISION));
        approvals.recordApproval(TOKEN, DECISION, a);
    }

    function test_anotherPasskeyCannotApprove() public {
        Approvals.Assertion memory a =
            _assertion(OTHER_PASSKEY, _authData(RP, 0x05), _clientData("webauthn.get", DECISION), "webauthn.get");
        vm.expectRevert(Approvals.SignatureInvalid.selector);
        approvals.recordApproval(TOKEN, DECISION, a);
    }

    function test_assertionFromAnotherWebsiteIsRefused() public {
        bytes32 phishing = sha256("chancela.xyz.evil.example");
        Approvals.Assertion memory a =
            _assertion(PASSKEY, _authData(phishing, 0x05), _clientData("webauthn.get", DECISION), "webauthn.get");
        vm.expectRevert(abi.encodeWithSelector(Approvals.WrongRelyingParty.selector, RP, phishing));
        approvals.recordApproval(TOKEN, DECISION, a);
    }

    function test_presenceWithoutUserVerificationIsNotEnough() public {
        Approvals.Assertion memory a =
            _assertion(PASSKEY, _authData(RP, 0x01), _clientData("webauthn.get", DECISION), "webauthn.get");
        vm.expectRevert(abi.encodeWithSelector(Approvals.UserNotVerified.selector, bytes1(0x01)));
        approvals.recordApproval(TOKEN, DECISION, a);
    }

    function test_aRegistrationCeremonyIsNotAnApproval() public {
        Approvals.Assertion memory a = _assertion(
            PASSKEY, _authData(RP, 0x05), _clientData("webauthn.create", DECISION), "webauthn.create"
        );
        vm.expectRevert(Approvals.NotAnAssertion.selector);
        approvals.recordApproval(TOKEN, DECISION, a);
    }

    function test_tamperedClientDataBreaksTheSignature() public {
        Approvals.Assertion memory a = _good(DECISION);
        // Same length and same indexed fields, different origin.
        a.clientDataJSON = string(
            abi.encodePacked(
                '{"type":"webauthn.get","challenge":"',
                Base64.encodeURL(abi.encodePacked(DECISION)),
                '","origin":"https://chancela.xyy","crossOrigin":false}'
            )
        );
        vm.expectRevert(Approvals.SignatureInvalid.selector);
        approvals.recordApproval(TOKEN, DECISION, a);
    }

    function test_indexesPointingPastTheEndAreRefusedNotReverted() public {
        Approvals.Assertion memory a = _good(DECISION);
        a.challengeIndex = 10_000;
        vm.expectRevert(Approvals.ChallengeMismatch.selector);
        approvals.recordApproval(TOKEN, DECISION, a);
    }

    function test_shortAuthenticatorDataIsRefused() public {
        Approvals.Assertion memory a = _good(DECISION);
        a.authenticatorData = hex"0011";
        vm.expectRevert(Approvals.AuthenticatorDataTooShort.selector);
        approvals.recordApproval(TOKEN, DECISION, a);
    }

    function test_noApproverNoApproval() public {
        identity.mint(2, owner);
        Approvals.Assertion memory a = _good(DECISION);
        vm.expectRevert(abi.encodeWithSelector(Approvals.ApproverNotSet.selector, uint256(2)));
        approvals.recordApproval(2, DECISION, a);
    }

    function test_onlyTheAgentOwnerSetsTheApprover() public {
        (uint256 x, uint256 y) = vm.publicKeyP256(OTHER_PASSKEY);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Approvals.NotAgentOwner.selector, TOKEN, stranger));
        approvals.setApprover(TOKEN, bytes32(x), bytes32(y));
    }

    function test_aPointOffTheCurveIsNotAKey() public {
        vm.prank(owner);
        vm.expectRevert(Approvals.ApproverKeyInvalid.selector);
        approvals.setApprover(TOKEN, bytes32(uint256(1)), bytes32(uint256(2)));
    }

    function test_replacingTheKeyStopsTheOldPasskey() public {
        (uint256 x, uint256 y) = vm.publicKeyP256(OTHER_PASSKEY);
        vm.prank(owner);
        approvals.setApprover(TOKEN, bytes32(x), bytes32(y));
        Approvals.Assertion memory a = _good(DECISION);
        vm.expectRevert(Approvals.SignatureInvalid.selector);
        approvals.recordApproval(TOKEN, DECISION, a);
    }

    function testFuzz_onlyTheExactDecisionVerifies(bytes32 signed, bytes32 claimed) public {
        vm.assume(signed != claimed);
        Approvals.Assertion memory a = _good(signed);
        vm.expectRevert(Approvals.ChallengeMismatch.selector);
        approvals.recordApproval(TOKEN, claimed, a);
    }
}
