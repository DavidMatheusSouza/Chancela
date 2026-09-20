# Smart contracts

## Design stance

Chancela does **not** implement agent identity. ERC-8004 already does, and its
Identity and Reputation registries are live on Monad. Re-implementing them would
mean competing with the standard the track explicitly points at, and producing an
agent registry that interoperates with nothing.

What ERC-8004 does not define is authorization. That is the gap:

| Registry | Question | Provider |
|---|---|---|
| Identity (`0x8004A169…`) | Who is this agent? | ERC-8004 |
| Reputation (`0x8004BAa1…`) | How has it behaved? | ERC-8004 |
| Validation | Was its work valid? | ERC-8004 — *coming soon on Monad* |
| **Policy** | **What may it do, and why was this decision made?** | **Chancela** |

## TrustAgentPolicyRegistry

> **On the name.** The project was called TrustAgent when this contract was
> compiled and deployed, and two things deliberately keep that name:
>
> - **The contract itself.** Solidity embeds a hash of the source metadata in the
>   bytecode. Renaming the contract would mean the source in this repository no
>   longer reproduces what is at `0x649DD587…6d4b`, and a later explorer
>   verification would fail. The deployed artefact is the record; the source
>   matches it.
> - **Agent ids (`TA-001`…) and audit ids (`TA-AUDIT-…`).** `hashPolicyDocument`
>   commits to the agent id, and those policy hashes are anchored on-chain.
>   `recordDecision` reverts with `PolicyHashMismatch` when a decision cites a
>   hash other than the anchored one, so renaming an agent would silently stop
>   every proof from landing. They are identifiers, not branding.

### Ownership is never duplicated

```solidity
modifier onlyAgentOwner(uint256 agentTokenId) {
    if (identityRegistry.ownerOf(agentTokenId) != msg.sender) {
        revert NotAgentOwner(agentTokenId, msg.sender);
    }
    _;
}
```

Ownership is read **live** from the ERC-8004 Identity Registry on every call.
Transfer the agent NFT and control follows it — no migration step, no cached
owner mapping to drift out of sync or be poisoned. `test_ownershipIsReadLiveFromIdentityRegistry`
covers exactly this.

### The attestor cannot be the agent

```solidity
if (attestor == _agentWallet[agentTokenId]) revert AttestorCannotBeAgentWallet();
```

An agent that signs its own authorizations proves nothing. `setAgentWallet()`
carries the symmetric check, so the separation cannot be defeated by calling the
two functions in the other order.

### Policy versions move forward only

```solidity
if (version <= current.version) revert PolicyVersionNotIncreasing(current.version, version);
```

Without this, an attacker could re-anchor an older, looser policy and make
"which policy was live at time T" ambiguous. With it, the question has exactly
one answer.

### A decision must name the live policy

```solidity
if (binding.policyHash != d.policyHash) revert PolicyHashMismatch(...);
```

A decision computed under v1 cannot be written once v2 is active. This closes
the window between evaluation and recording.

### Replay protection

```solidity
if (_decisionRecorded[d.decisionHash]) revert DecisionAlreadyRecorded(d.decisionHash);
```

Independent of the off-chain nonce store. Two layers, deliberately.

### Denials are recorded

`recordDecision` takes a `Decision` enum, not a success flag. `DENY` events are
first-class. A registry that only proves the allows is a marketing artefact.

## Interface

```solidity
// owner only
function setAttestor(uint256 agentTokenId, address attestor) external;
function setAgentWallet(uint256 agentTokenId, address wallet) external;
function anchorPolicy(uint256 agentTokenId, uint32 version, bytes32 policyHash) external;
function suspendAgent(uint256 agentTokenId, bytes32 reasonCode) external;
function reactivateAgent(uint256 agentTokenId) external;

// attestor only
function recordDecision(DecisionInput calldata d) external;
function recordDecisionBatch(DecisionInput[] calldata items) external;  // max 100

// views
function activePolicy(uint256) external view returns (bytes32, uint32, uint64);
function attestorOf(uint256) external view returns (address);
function isSuspended(uint256) external view returns (bool);
function isDecisionRecorded(bytes32) external view returns (bool);
function decisionCount(uint256) external view returns (uint64);
```

## Events

```solidity
event AttestorSet(uint256 indexed agentTokenId, address indexed attestor, address indexed setBy);
event AgentWalletSet(uint256 indexed agentTokenId, address indexed wallet);
event PolicyAnchored(uint256 indexed agentTokenId, uint32 indexed version, bytes32 policyHash, address owner, uint64 anchoredAt);
event DecisionRecorded(uint256 indexed agentTokenId, bytes32 indexed decisionHash, bytes4 indexed action, uint8 decision, uint8 risk, bytes32 intentHash, bytes32 policyHash, uint64 recordedAt);
event AgentSuspended(uint256 indexed agentTokenId, bytes32 reasonCode, uint64 at);
event AgentReactivated(uint256 indexed agentTokenId, uint64 at);
```

**No event carries a `string`.** Prompts, parameters and personal data are
structurally incapable of reaching the chain — a property, not a policy.

`action` is the first 4 bytes of `keccak256(actionName)`, giving a fixed-width
tag that indexes cleanly.

## Testing

26 Foundry tests, including fuzzing:

```
testFuzz_onlyAttestorEverRecords(address)          256 runs
testFuzz_policyVersionMonotonic(uint32,uint32)     256 runs
testFuzz_decisionHashRecordedExactlyOnce(bytes32)  256 runs
```

```bash
pnpm --filter @chancela/contracts test
pnpm --filter @chancela/contracts test:gas
```

## Deployment

```bash
export DEPLOYER_PRIVATE_KEY=0x...
export ERC8004_IDENTITY_REGISTRY=0x...     # required on testnet
pnpm --filter @chancela/contracts deploy:testnet
```

On mainnet the ERC-8004 address defaults to `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`.
On testnet no address is published, so the script **refuses to guess** and
requires the variable. The deployed addresses are written to
`packages/contracts/deployments/<chainId>.json`.
