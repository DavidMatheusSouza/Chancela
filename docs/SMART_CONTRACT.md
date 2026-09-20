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
>   longer reproduces what is at `0xb403392D…412e`, and a later explorer
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

---

## ChancelaApprovals — a human's approval, verified by the chain

| | |
|---|---|
| Address (testnet 10143) | [`0x4ed26528cC5518df075A4Ba463D56B478fAba42b`](https://testnet.monadexplorer.com/address/0x4ed26528cC5518df075A4Ba463D56B478fAba42b) |
| Source | `packages/contracts/src/ChancelaApprovals.sol` · 15 tests in `test/ChancelaApprovals.t.sol` |
| Status | **Contract deployed and verified on-chain. The approval screen that feeds it is not wired yet** — a `REQUIRE_APPROVAL` decision still has nowhere to be approved in the app. |

When a policy answers `REQUIRE_APPROVAL`, "the owner clicked approve" must not be
the service's word. The owner's passkey signs a WebAuthn assertion whose
challenge is the **decision hash**, and this contract verifies it with Monad's
native P-256 precompile (RIP-7212, `0x100`) against the key the agent's ERC-8004
owner registered with `setApprover()`.

```solidity
function setApprover(uint256 agentTokenId, bytes32 x, bytes32 y) external;          // agent owner only
function recordApproval(uint256 agentTokenId, bytes32 decisionHash, Assertion a) external; // anyone
function approvedAt(bytes32 decisionHash) external view returns (uint64);
```

What is checked, and what each check stops:

| Check | Stops |
|---|---|
| `authenticatorData[0:32] == sha256("chancela.xyz")` | an assertion phished on another website |
| user-present **and** user-verified flags | a tap without biometric or PIN |
| `"type":"webauthn.get"` at the given index | a registration ceremony passed off as an approval |
| `"challenge":"<base64url(decisionHash)>"` at the given index | an approval moved to another decision |
| P-256 signature over `authenticatorData ‖ sha256(clientDataJSON)` | any other key, any edited byte |
| one approval per decision hash | replay |

Anyone may submit the assertion: the signature carries the authority, not the
sender. Because the decision hash commits to the intent hash, the policy hash
and the nonce, approving it approves exactly those parameters under exactly
that policy.

Measured on Monad testnet by simulation against the deployed contract: a
well-formed assertion is accepted for **about 82,000 gas**; the same assertion
presented for another decision, and one with a flipped signature bit, are
refused. The Solidity fallback OpenZeppelin uses where the precompile is missing
costs roughly four times that, which is the practical meaning of "native P-256"
here.

It is a separate contract on purpose: approvals are an addition, and the
registry that already holds the record stays as deployed.
