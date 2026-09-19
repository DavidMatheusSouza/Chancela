// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IIdentityRegistry} from "./IIdentityRegistry.sol";

/**
 * @title TrustAgentPolicyRegistry
 * @notice The authorization and accountability layer that ERC-8004 does not define.
 *
 * ERC-8004 answers "who is this agent" (Identity Registry) and "how did it behave"
 * (Reputation Registry). It says nothing about what an agent is *permitted* to do,
 * or how a specific allow/deny decision can later be proven. That is this contract.
 *
 * Design constraints, all deliberate:
 *
 *  - Identity is never duplicated. Ownership is always read live from the ERC-8004
 *    Identity Registry via ownerOf(). Transfer the agent NFT and control follows it,
 *    with no migration step and no stale owner mapping to go out of sync.
 *
 *  - Only hashes are stored. No prompts, no parameters, no PII. A verifier recomputes
 *    the hash off-chain from the canonical JSON and compares. The chain proves that a
 *    decision existed at a block, under a named policy version -- not what was said.
 *
 *  - Decisions are written by a per-agent attestor key, which must NOT be the agent's
 *    own wallet key. If the agent could sign its own authorizations, the record would
 *    prove nothing. setAttestor() is owner-only and rejects the agent wallet.
 *
 *  - Policy versions move forward only. A replayed or re-anchored old version is
 *    rejected, so "which policy was live at time T" has exactly one answer.
 */
contract TrustAgentPolicyRegistry {
    /* ----------------------------------------------------------------- types */

    enum Decision {
        DENY,
        ALLOW,
        REQUIRE_APPROVAL
    }

    enum Risk {
        LOW,
        MEDIUM,
        HIGH,
        CRITICAL
    }

    struct PolicyBinding {
        bytes32 policyHash;
        uint32 version;
        uint64 anchoredAt;
    }

    struct DecisionInput {
        uint256 agentTokenId;
        bytes32 decisionHash;
        bytes32 intentHash;
        bytes4 action;
        Decision decision;
        Risk risk;
        bytes32 policyHash;
    }

    /* ---------------------------------------------------------------- storage */

    IIdentityRegistry public immutable identityRegistry;

    mapping(uint256 => PolicyBinding) private _policy;
    mapping(uint256 => address) private _attestor;
    mapping(uint256 => bool) private _suspended;
    mapping(uint256 => address) private _agentWallet;
    /// @dev Replay guard: a decision hash can only ever be recorded once.
    mapping(bytes32 => bool) private _decisionRecorded;
    mapping(uint256 => uint64) private _decisionCount;

    /* ----------------------------------------------------------------- events */

    event AttestorSet(uint256 indexed agentTokenId, address indexed attestor, address indexed setBy);
    event AgentWalletSet(uint256 indexed agentTokenId, address indexed wallet);
    event PolicyAnchored(
        uint256 indexed agentTokenId,
        uint32 indexed version,
        bytes32 policyHash,
        address owner,
        uint64 anchoredAt
    );
    event DecisionRecorded(
        uint256 indexed agentTokenId,
        bytes32 indexed decisionHash,
        bytes4 indexed action,
        Decision decision,
        Risk risk,
        bytes32 intentHash,
        bytes32 policyHash,
        uint64 recordedAt
    );
    event AgentSuspended(uint256 indexed agentTokenId, bytes32 reasonCode, uint64 at);
    event AgentReactivated(uint256 indexed agentTokenId, uint64 at);

    /* ----------------------------------------------------------------- errors */

    error NotAgentOwner(uint256 agentTokenId, address caller);
    error NotAttestor(uint256 agentTokenId, address caller);
    error AttestorNotSet(uint256 agentTokenId);
    error AttestorCannotBeAgentWallet();
    error AttestorCannotBeZero();
    error PolicyVersionNotIncreasing(uint32 current, uint32 submitted);
    error PolicyHashEmpty();
    error NoPolicyAnchored(uint256 agentTokenId);
    error PolicyHashMismatch(bytes32 expected, bytes32 submitted);
    error DecisionAlreadyRecorded(bytes32 decisionHash);
    error AgentIsSuspended(uint256 agentTokenId);
    error AgentNotSuspended(uint256 agentTokenId);
    error EmptyBatch();
    error BatchTooLarge(uint256 length);

    uint256 public constant MAX_BATCH = 100;

    /* ------------------------------------------------------------- modifiers */

    modifier onlyAgentOwner(uint256 agentTokenId) {
        if (identityRegistry.ownerOf(agentTokenId) != msg.sender) {
            revert NotAgentOwner(agentTokenId, msg.sender);
        }
        _;
    }

    constructor(address identityRegistry_) {
        identityRegistry = IIdentityRegistry(identityRegistry_);
    }

    /* ------------------------------------------------------------ owner admin */

    /// @notice Bind the off-chain policy engine's attestation key to an agent.
    /// @dev Rejects the agent's own wallet: an agent must not be able to sign
    ///      the record that authorizes it.
    function setAttestor(uint256 agentTokenId, address attestor)
        external
        onlyAgentOwner(agentTokenId)
    {
        if (attestor == address(0)) revert AttestorCannotBeZero();
        if (attestor == _agentWallet[agentTokenId]) revert AttestorCannotBeAgentWallet();
        _attestor[agentTokenId] = attestor;
        emit AttestorSet(agentTokenId, attestor, msg.sender);
    }

    /// @notice Declare the agent's operating wallet, so the attestor can be checked against it.
    function setAgentWallet(uint256 agentTokenId, address wallet)
        external
        onlyAgentOwner(agentTokenId)
    {
        if (wallet != address(0) && wallet == _attestor[agentTokenId]) {
            revert AttestorCannotBeAgentWallet();
        }
        _agentWallet[agentTokenId] = wallet;
        emit AgentWalletSet(agentTokenId, wallet);
    }

    /// @notice Anchor a policy version. Versions are strictly increasing.
    function anchorPolicy(uint256 agentTokenId, uint32 version, bytes32 policyHash)
        external
        onlyAgentOwner(agentTokenId)
    {
        if (policyHash == bytes32(0)) revert PolicyHashEmpty();
        PolicyBinding storage current = _policy[agentTokenId];
        if (version <= current.version) {
            revert PolicyVersionNotIncreasing(current.version, version);
        }
        current.policyHash = policyHash;
        current.version = version;
        current.anchoredAt = uint64(block.timestamp);
        emit PolicyAnchored(agentTokenId, version, policyHash, msg.sender, uint64(block.timestamp));
    }

    function suspendAgent(uint256 agentTokenId, bytes32 reasonCode)
        external
        onlyAgentOwner(agentTokenId)
    {
        if (_suspended[agentTokenId]) revert AgentIsSuspended(agentTokenId);
        _suspended[agentTokenId] = true;
        emit AgentSuspended(agentTokenId, reasonCode, uint64(block.timestamp));
    }

    function reactivateAgent(uint256 agentTokenId) external onlyAgentOwner(agentTokenId) {
        if (!_suspended[agentTokenId]) revert AgentNotSuspended(agentTokenId);
        _suspended[agentTokenId] = false;
        emit AgentReactivated(agentTokenId, uint64(block.timestamp));
    }

    /* ------------------------------------------------------------ attestation */

    /// @notice Record one authorization decision.
    /// @dev Deliberately records DENY as well as ALLOW. A registry that only
    ///      proves the allows is a marketing artefact, not an audit trail.
    function recordDecision(DecisionInput calldata d) external {
        _recordDecision(d);
    }

    /// @notice Record many decisions in one transaction.
    function recordDecisionBatch(DecisionInput[] calldata items) external {
        uint256 len = items.length;
        if (len == 0) revert EmptyBatch();
        if (len > MAX_BATCH) revert BatchTooLarge(len);
        for (uint256 i = 0; i < len; ++i) {
            _recordDecision(items[i]);
        }
    }

    function _recordDecision(DecisionInput calldata d) private {
        address attestor = _attestor[d.agentTokenId];
        if (attestor == address(0)) revert AttestorNotSet(d.agentTokenId);
        if (msg.sender != attestor) revert NotAttestor(d.agentTokenId, msg.sender);
        if (_suspended[d.agentTokenId]) revert AgentIsSuspended(d.agentTokenId);
        if (_decisionRecorded[d.decisionHash]) revert DecisionAlreadyRecorded(d.decisionHash);

        PolicyBinding storage binding = _policy[d.agentTokenId];
        if (binding.version == 0) revert NoPolicyAnchored(d.agentTokenId);
        // The decision must name the policy that is actually live. This is what
        // makes "which policy authorized this" unforgeable after the fact.
        if (binding.policyHash != d.policyHash) {
            revert PolicyHashMismatch(binding.policyHash, d.policyHash);
        }

        _decisionRecorded[d.decisionHash] = true;
        unchecked {
            _decisionCount[d.agentTokenId] += 1;
        }

        emit DecisionRecorded(
            d.agentTokenId,
            d.decisionHash,
            d.action,
            d.decision,
            d.risk,
            d.intentHash,
            d.policyHash,
            uint64(block.timestamp)
        );
    }

    /* ----------------------------------------------------------------- views */

    function activePolicy(uint256 agentTokenId)
        external
        view
        returns (bytes32 policyHash, uint32 version, uint64 anchoredAt)
    {
        PolicyBinding storage b = _policy[agentTokenId];
        return (b.policyHash, b.version, b.anchoredAt);
    }

    function attestorOf(uint256 agentTokenId) external view returns (address) {
        return _attestor[agentTokenId];
    }

    function agentWalletOf(uint256 agentTokenId) external view returns (address) {
        return _agentWallet[agentTokenId];
    }

    function isSuspended(uint256 agentTokenId) external view returns (bool) {
        return _suspended[agentTokenId];
    }

    function isDecisionRecorded(bytes32 decisionHash) external view returns (bool) {
        return _decisionRecorded[decisionHash];
    }

    function decisionCount(uint256 agentTokenId) external view returns (uint64) {
        return _decisionCount[agentTokenId];
    }
}
