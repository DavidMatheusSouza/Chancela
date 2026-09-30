# Audit

What has been checked in the contracts, how, and what is still a known limit.
This is a self-review with tools, not a professional audit; nobody outside the
project has reviewed this code yet.

Scope: the five contracts deployed on Monad testnet and verified on Sourcify
(exact match) — `TrustAgentPolicyRegistry`, `ChancelaGate`, `ChancelaGuarded`,
`ChancelaDemoVenue`, `ChancelaApprovals` — plus our testnet copy of the
ERC-8004 identity registry.

## How it was checked

| Method | What it covers | Where it runs |
|---|---|---|
| Unit tests (Foundry) | One test per refusal reason of the gate, every revert of the registry and of the approvals contract | CI, every push |
| Stateful invariants | 10 invariants (6 registry, 4 gate) against a reference model, 256 runs × depth 100 | CI |
| Mutation check | Each of the gate's 12 rules removed in turn; every mutant must fail a test. 12/12 killed | CI (`script/mutants.sh`) |
| Official ERC-8004, mainnet fork | Registry, gate and venue deployed against the ERC-8004 registry that is live on Monad mainnet (`0x8004A169…a432`): an identity registered there governs the policy, the attestor and the gate here, and selling the identity hands over control | CI (`test/OfficialERC8004.fork.t.sol`) |
| TS ↔ Solidity vectors | EIP-712 grant digests computed in TypeScript equal the contract's | CI |
| End to end on anvil | The web app's attestor signs, the agent sends, the contracts decide | CI |
| Static analysis | Slither 0.11.4, 100 detectors, dependencies excluded | CI, fails on any high-impact finding |
| Live, against the chain | `npx chancela-check` forges grants and asks Monad to execute them; it reverts each one | Anyone, any time |

## Slither findings, triaged

Run on 30 September 2026: **0 high, 2 medium, 4 low, all reviewed.** None
required a code change. Reproduce with
`slither packages/contracts --filter-paths "lib/|test/|script/"`.

| Impact | Detector | Where | Verdict |
|---|---|---|---|
| Medium | `unused-return` | `ChancelaGate._check`: third value of `ECDSA.tryRecover` ignored | Intended. That value is the argument of the error (e.g. the bad signature length). The error *kind* is checked: anything but `NoError` is `BAD_SIGNATURE`. |
| Medium | `unused-return` | `ChancelaGate._check`: `version` and `anchoredAt` of `activePolicy` ignored | Intended. The grant commits to the policy **hash**; comparing the hash already covers any version change. |
| Low | `timestamp` | `ChancelaGate._check`: `block.timestamp >= grant.expiresAt` | Intended. Grants live 60 seconds; a validator's timestamp freedom is far below that. The boundary itself is pinned by a test and by the "expiry off by one" mutant. |
| Low | `timestamp` | `ChancelaApprovals.recordApproval`: `_approvedAt[decisionHash] != 0` | False positive. The stored timestamp is only compared with zero, as a "was this decision already approved" flag; its value never decides anything. |
| Low | `reentrancy-benign`, `reentrancy-events` | `ChancelaDemoVenue.placeOrder`: state written and event emitted after `gate.consume()` | Benign. The external call is to the immutable gate, which calls only the registry's view functions and never calls back. The grant is marked used inside the gate **before** it returns, so a re-entrant second use would be refused as `ALREADY_USED` anyway. |

## Known limits

These are design decisions or open work, written down so nobody has to find them:

1. **The attestor is a trusted key.** The chain checks that a grant was signed
   by the attestor the owner registered; it does not re-run the policy. A
   stolen attestor key can sign grants within any agent that trusts it. The
   owner can replace it in one transaction (`setAttestor`), and every grant
   signed by the old key dies with it. Production should hold it in a KMS/HSM;
   here it is an environment variable (see [THREAT_MODEL.md](THREAT_MODEL.md)).
2. **One attestor today.** A second, independently operated attestor is on the
   roadmap ([ADOPTION.md](ADOPTION.md)); until then "not capturable" rests on
   the owner being able to leave, not on there being an alternative running.
3. **Only venues that inherit `ChancelaGuarded` enforce on-chain.** Everywhere
   else the SDK's local verification is the enforcement, which the agent's own
   code must not skip. The gate is what removes that trust for venues that opt in.
4. **Testnet deployment.** The contracts are unchanged for mainnet and pass
   against the official ERC-8004 registry on a mainnet fork, but they are not
   deployed there yet.
5. **The ERC-8004 registry on testnet is our copy**, because the official one
   exists only on mainnet. It implements the part Chancela reads
   (`ownerOf`, ERC-721 transfers); the fork test above is the evidence that the
   official one behaves the same for us.

Related: [SECURITY.md](SECURITY.md) for controls and key handling,
[THREAT_MODEL.md](THREAT_MODEL.md) for eighteen attacks and what stops each one.
