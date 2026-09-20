// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {P256} from "@openzeppelin/contracts/utils/cryptography/P256.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {IIdentityRegistry} from "./IIdentityRegistry.sol";

/// @title ChancelaApprovals
/// @notice A human's approval of one agent decision, given with a passkey and
///         checked by the chain itself.
///
/// When a policy says an action needs its owner's approval, "the owner clicked
/// approve" is the service's word. Here the owner's passkey signs a WebAuthn
/// assertion whose challenge is the decision hash, and this contract verifies
/// that assertion with Monad's native P-256 precompile (RIP-7212, at 0x100)
/// against the key the agent's ERC-8004 owner registered. Anyone can submit it:
/// the signature is what carries the authority, not the sender.
///
/// What a verified approval proves: the holder of that passkey, with user
/// verification (biometric or PIN), on this relying party, approved exactly this
/// decision -- and therefore exactly the intent, policy and parameters the
/// decision hash commits to. It cannot be replayed onto another decision, lifted
/// from another website, or produced by the service on its own.
///
/// @dev Separate from TrustAgentPolicyRegistry on purpose: approvals are an
///      addition, and the registry that already holds the record stays as deployed.
contract ChancelaApprovals {
    struct Approver {
        bytes32 x;
        bytes32 y;
    }

    /// @dev A WebAuthn assertion, as the browser returns it, plus where to look
    ///      inside clientDataJSON. The indexes save the contract from parsing
    ///      JSON; what is found at them is still checked byte for byte.
    struct Assertion {
        bytes authenticatorData;
        string clientDataJSON;
        uint256 typeIndex;
        uint256 challengeIndex;
        bytes32 r;
        bytes32 s;
    }

    IIdentityRegistry public immutable identityRegistry;
    /// @notice sha256 of the relying-party id (the site's hostname). An assertion
    ///         made for any other site carries a different hash and is refused.
    bytes32 public immutable rpIdHash;

    mapping(uint256 => Approver) private _approver;
    mapping(bytes32 => uint64) private _approvedAt;

    event ApproverSet(uint256 indexed agentTokenId, bytes32 x, bytes32 y, address indexed setBy);
    event ApprovalVerified(
        uint256 indexed agentTokenId, bytes32 indexed decisionHash, bytes32 indexed approverKeyHash, uint64 at
    );

    error NotAgentOwner(uint256 agentTokenId, address caller);
    error ApproverKeyInvalid();
    error ApproverNotSet(uint256 agentTokenId);
    error AlreadyApproved(bytes32 decisionHash);
    error AuthenticatorDataTooShort();
    error WrongRelyingParty(bytes32 expected, bytes32 got);
    error UserNotVerified(bytes1 flags);
    error NotAnAssertion();
    error ChallengeMismatch();
    error SignatureInvalid();

    /// @dev flags byte of authenticatorData: bit 0 user present, bit 2 user verified.
    bytes1 private constant UP_AND_UV = 0x05;
    bytes private constant TYPE_GET = '"type":"webauthn.get"';
    bytes private constant CHALLENGE_PREFIX = '"challenge":"';

    constructor(address identityRegistry_, bytes32 rpIdHash_) {
        identityRegistry = IIdentityRegistry(identityRegistry_);
        rpIdHash = rpIdHash_;
    }

    /// @notice Register the P-256 public key of the passkey that approves for this agent.
    /// @dev Only the holder of the agent's ERC-8004 identity. Replacing the key
    ///      does not unverify approvals already recorded.
    function setApprover(uint256 agentTokenId, bytes32 x, bytes32 y) external {
        if (identityRegistry.ownerOf(agentTokenId) != msg.sender) {
            revert NotAgentOwner(agentTokenId, msg.sender);
        }
        if (!P256.isValidPublicKey(x, y)) revert ApproverKeyInvalid();
        _approver[agentTokenId] = Approver(x, y);
        emit ApproverSet(agentTokenId, x, y, msg.sender);
    }

    /// @notice Verify a passkey approval of `decisionHash` and record it. Callable by anyone.
    function recordApproval(uint256 agentTokenId, bytes32 decisionHash, Assertion calldata a) external {
        Approver memory key = _approver[agentTokenId];
        if (key.x == bytes32(0) && key.y == bytes32(0)) revert ApproverNotSet(agentTokenId);
        if (_approvedAt[decisionHash] != 0) revert AlreadyApproved(decisionHash);

        // authenticatorData = rpIdHash (32) | flags (1) | signCount (4) | ...
        bytes calldata auth = a.authenticatorData;
        if (auth.length < 37) revert AuthenticatorDataTooShort();
        bytes32 rp = bytes32(auth[0:32]);
        if (rp != rpIdHash) revert WrongRelyingParty(rpIdHash, rp);
        if (auth[32] & UP_AND_UV != UP_AND_UV) revert UserNotVerified(auth[32]);

        // The signed client data must be an assertion, and its challenge must be
        // this decision -- base64url, unpadded, as WebAuthn serialises it.
        bytes calldata client = bytes(a.clientDataJSON);
        if (!_at(client, a.typeIndex, TYPE_GET)) revert NotAnAssertion();
        bytes memory expected =
            abi.encodePacked(CHALLENGE_PREFIX, Base64.encodeURL(abi.encodePacked(decisionHash)), '"');
        if (!_at(client, a.challengeIndex, expected)) revert ChallengeMismatch();

        bytes32 message = sha256(abi.encodePacked(auth, sha256(client)));
        if (!P256.verify(message, a.r, a.s, key.x, key.y)) revert SignatureInvalid();

        _approvedAt[decisionHash] = uint64(block.timestamp);
        emit ApprovalVerified(
            agentTokenId, decisionHash, keccak256(abi.encodePacked(key.x, key.y)), uint64(block.timestamp)
        );
    }

    function approverOf(uint256 agentTokenId) external view returns (bytes32 x, bytes32 y) {
        Approver memory key = _approver[agentTokenId];
        return (key.x, key.y);
    }

    /// @notice When `decisionHash` was approved, or 0 if it never was.
    function approvedAt(bytes32 decisionHash) external view returns (uint64) {
        return _approvedAt[decisionHash];
    }

    function _at(bytes calldata haystack, uint256 index, bytes memory needle) private pure returns (bool) {
        uint256 end = index + needle.length;
        if (end > haystack.length) return false;
        return keccak256(haystack[index:end]) == keccak256(needle);
    }
}
