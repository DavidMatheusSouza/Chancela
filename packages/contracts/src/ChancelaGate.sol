// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {IIdentityRegistry} from "./IIdentityRegistry.sol";

/// @dev The parts of TrustAgentPolicyRegistry the gate reads. The registry is
///      already deployed and stays as it is; the gate only ever reads it.
interface IChancelaPolicyRegistry {
    function identityRegistry() external view returns (IIdentityRegistry);
    function activePolicy(uint256 agentTokenId)
        external
        view
        returns (bytes32 policyHash, uint32 version, uint64 anchoredAt);
    function attestorOf(uint256 agentTokenId) external view returns (address);
    function agentWalletOf(uint256 agentTokenId) external view returns (address);
    function isSuspended(uint256 agentTokenId) external view returns (bool);
}

/// @title ChancelaGate
/// @notice No chancela, no execution -- enforced by the contract that executes.
///
/// The policy engine decides off-chain and its attestor signs the decision. Until
/// now the chain only recorded that decision; a protocol that wanted to act on it
/// had to trust whoever relayed it. Here the protocol asks the chain instead: it
/// hands the gate the attestor's grant and a hash of the call it is about to make,
/// and the gate either consumes the grant or reverts the whole transaction.
///
/// A grant is honoured only if, at the moment of execution:
///   - it was signed by the attestor the agent's ERC-8004 owner registered,
///   - it names this exact call (target contract and call hash), sent by the
///     agent's registered wallet,
///   - the policy it was decided under is still the live one,
///   - the agent is not suspended, the grant has not expired, and it has never
///     been used or revoked.
///
/// Everything is read live from the registry, so the owner's controls there
/// bind every outstanding grant at once: suspend the agent, anchor a new policy
/// version, or rotate the attestor, and grants issued before stop working in the
/// next block -- no list of grants to chase, no cooperation from the service.
///
/// @dev The grant is keyed by the decision hash, the identifier already anchored
///      in the registry, so an executed call points straight at the public record
///      of the decision that allowed it.
contract ChancelaGate is EIP712 {
    struct Grant {
        uint256 agentTokenId;
        /// The contract that must consume the grant. Stops a grant for one venue
        /// from being spent at another.
        address target;
        /// Hash of the call the target is about to make, computed by the target
        /// from the arguments it actually received.
        bytes32 callHash;
        /// The decision this grant carries out, as anchored in the registry.
        bytes32 decisionHash;
        /// The policy the decision was taken under.
        bytes32 policyHash;
        uint64 expiresAt;
    }

    /// @dev Ordered cheapest-first, the same order the checks run in.
    enum Reason {
        OK,
        WRONG_TARGET,
        CALL_MISMATCH,
        EXPIRED,
        ALREADY_USED,
        AGENT_SUSPENDED,
        POLICY_CHANGED,
        NOT_THE_AGENT,
        ATTESTOR_NOT_SET,
        BAD_SIGNATURE
    }

    bytes32 public constant GRANT_TYPEHASH = keccak256(
        "Grant(uint256 agentTokenId,address target,bytes32 callHash,bytes32 decisionHash,bytes32 policyHash,uint64 expiresAt)"
    );

    IChancelaPolicyRegistry public immutable registry;

    /// @dev decisionHash => spent or revoked. One decision, one execution.
    mapping(bytes32 => bool) private _used;

    event GrantConsumed(
        uint256 indexed agentTokenId,
        bytes32 indexed decisionHash,
        address indexed target,
        bytes32 callHash,
        address agent
    );
    event GrantRevoked(uint256 indexed agentTokenId, bytes32 indexed decisionHash, address by);

    error Refused(Reason reason);
    error NotAgentOwner(uint256 agentTokenId, address caller);

    constructor(address registry_) EIP712("Chancela", "1") {
        registry = IChancelaPolicyRegistry(registry_);
    }

    /// @notice Spend a grant. Called by the protocol about to execute, never by
    ///         the agent directly: `msg.sender` must be the grant's target.
    /// @param agent The account that asked the target to act (the target's own
    ///        `msg.sender`); must be the agent's registered wallet.
    /// @param callHash What the target computed from the arguments it received.
    function consume(
        Grant calldata grant,
        bytes calldata signature,
        address agent,
        bytes32 callHash
    ) external {
        Reason r = _check(grant, signature, msg.sender, agent, callHash);
        if (r != Reason.OK) revert Refused(r);
        _used[grant.decisionHash] = true;
        emit GrantConsumed(grant.agentTokenId, grant.decisionHash, msg.sender, callHash, agent);
    }

    /// @notice What `consume` would answer, without spending anything. For
    ///         front-ends, and for anyone checking a grant before relaying it.
    function check(
        Grant calldata grant,
        bytes calldata signature,
        address target,
        address agent,
        bytes32 callHash
    ) external view returns (Reason) {
        return _check(grant, signature, target, agent, callHash);
    }

    /// @notice Cancel one outstanding grant. Only the agent's ERC-8004 owner.
    /// @dev Revoking is marking as used, so it also works on a grant nobody has
    ///      seen yet: the owner only needs the decision hash from the record.
    function revoke(uint256 agentTokenId, bytes32 decisionHash) external {
        if (registry.identityRegistry().ownerOf(agentTokenId) != msg.sender) {
            revert NotAgentOwner(agentTokenId, msg.sender);
        }
        if (_used[decisionHash]) revert Refused(Reason.ALREADY_USED);
        _used[decisionHash] = true;
        emit GrantRevoked(agentTokenId, decisionHash, msg.sender);
    }

    function isUsed(bytes32 decisionHash) external view returns (bool) {
        return _used[decisionHash];
    }

    /// @notice The EIP-712 digest the attestor signs.
    function grantDigest(Grant calldata grant) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    GRANT_TYPEHASH,
                    grant.agentTokenId,
                    grant.target,
                    grant.callHash,
                    grant.decisionHash,
                    grant.policyHash,
                    grant.expiresAt
                )
            )
        );
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function _check(
        Grant calldata grant,
        bytes calldata signature,
        address target,
        address agent,
        bytes32 callHash
    ) private view returns (Reason) {
        if (grant.target != target) return Reason.WRONG_TARGET;
        if (grant.callHash != callHash) return Reason.CALL_MISMATCH;
        if (block.timestamp >= grant.expiresAt) return Reason.EXPIRED;
        if (_used[grant.decisionHash]) return Reason.ALREADY_USED;

        uint256 id = grant.agentTokenId;
        if (registry.isSuspended(id)) return Reason.AGENT_SUSPENDED;
        (bytes32 livePolicy,,) = registry.activePolicy(id);
        if (livePolicy != grant.policyHash) return Reason.POLICY_CHANGED;
        address wallet = registry.agentWalletOf(id);
        if (wallet == address(0) || wallet != agent) return Reason.NOT_THE_AGENT;
        address attestor = registry.attestorOf(id);
        if (attestor == address(0)) return Reason.ATTESTOR_NOT_SET;

        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(grantDigest(grant), signature);
        if (err != ECDSA.RecoverError.NoError || signer != attestor) return Reason.BAD_SIGNATURE;
        return Reason.OK;
    }
}
