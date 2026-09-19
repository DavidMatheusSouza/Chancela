# Architecture

## The trust boundary

Everything in TrustAgent is organised around one line:

```
┌─────────────── UNTRUSTED ────────────────┐
│  User prose                              │
│  AI provider (Qwen / Kimi / OpenAI)      │
│  Raw structured intent                   │
└──────────────────┬───────────────────────┘
                   │
══════════════ TRUST BOUNDARY ══════════════
                   │
┌──────────────────▼───────────────────────┐
│  Zod schema validation                   │
│  Tool Registry lookup                    │
│  Permission check (deny by default)      │
│  Counterparty denylist                   │
│  Value + rate limits                     │
│  Environment + time window               │
│  Risk engine  ◄── Nansen labels          │
│  Step-up threshold                       │
│              ▼                           │
│      Authorization Capsule (signed)      │
└──────────────────┬───────────────────────┘
                   │
      ┌────────────┴────────────┐
      ▼                         ▼
 Tool Executor            Audit Writer (async)
 (verify → act)                  │
                                 ▼
                    TrustAgentPolicyRegistry (Monad)
                                 │
                                 ▼
                       Envio HyperIndex → GraphQL
```

Nothing from the untrusted side crosses the line except an `action` string and a
`parameters` object — both of which are then validated against a closed schema
before anything looks at them.

## Packages

| Package | Responsibility | Constraint |
|---|---|---|
| `policy-engine` | The decision | **Pure.** No I/O, no network, no ambient clock. Time is injected. |
| `shared` | Canonical JSON, hashing, schemas, tool registry | No runtime dependencies beyond viem + zod |
| `ai` | Intent extraction | Cannot express an authorization outcome |
| `contracts` | On-chain anchoring | Binds to ERC-8004; never duplicates identity |
| `indexer` | Envio HyperIndex | Reads the chain, not our database |
| `mm-plugin` | MetaMask Agent Wallet | Calls the same public endpoint as the UI |
| `apps/web` | Dashboard + REST API | Thin; orchestration only |

The policy engine being pure is not stylistic. It is what makes 48 tests —
including property-based fuzzing over arbitrary input — cheap enough to run on
every push, and what lets an auditor read the entire decision path in one file.

## The decision pipeline

`evaluate()` runs eleven steps and short-circuits on the first failure.

| # | Step | Failure |
|---|---|---|
| 1 | Agent status | `AGENT_SUSPENDED` / `AGENT_REVOKED` |
| 2 | Policy bound and unexpired | `POLICY_INACTIVE` / `POLICY_EXPIRED` |
| 3 | Action exists in the Tool Registry | `UNKNOWN_ACTION` / `TOOL_DISABLED` |
| 4 | Permission granted by this policy | `PERMISSION_DENIED` |
| 5 | Parameters match the tool input schema | `INVALID_PARAMETERS` |
| 6 | Counterparty not on the policy denylist | `COUNTERPARTY_BLOCKED` |
| 7 | Value, daily count and daily cap | `LIMIT_EXCEEDED` / `DAILY_LIMIT_EXCEEDED` |
| 8 | Environment and UTC time window | `ENVIRONMENT_NOT_ALLOWED` / `OUT_OF_TIME_WINDOW` |
| 9 | Risk assessment | — (produces a level) |
| 10 | Step-up threshold | `REQUIRE_APPROVAL` |
| 11 | Allow | `OK` |

Every outcome carries the full ordered trace, which the UI renders and the audit
record stores. A denial always names the step that produced it.

### Why the default is at the bottom

There is exactly one `build(input, 'ALLOW', …)` in the source. A test greps for
it and fails if a second appears, and another test asserts it sits after the
step-up check. This makes "someone adds an early return for a special case" a
build failure rather than a silent privilege escalation.

## Risk

Risk starts at the tool's registry value — never at anything a model said — and
can only be escalated:

- value above 80% of the policy ceiling → +1 level
- counterparty severity ≥ 50 → +1 level
- counterparty severity ≥ 80 → +2 levels

There is no input that makes `TRANSFER_FUNDS` look safe. Nansen (or the local
denylist fallback) supplies severity; it cannot supply permission.

## Hashing

Everything provable rests on canonical JSON (a pragmatic subset of RFC 8785):
keys sorted recursively, no insignificant whitespace, `undefined` dropped,
non-finite numbers and `bigint` and `Date` rejected rather than coerced.

| Hash | Commits to | Purpose |
|---|---|---|
| `policyHash` | agentId, version, sorted permissions, limits, threshold, environment | Prove which rules were live |
| `intentHash` | agentId, action, parameters | Bind a decision to exact parameters |
| `decisionHash` | all of the above + decision, risk, reason, nonce, issuedAt | On-chain identifier |

Cosmetic fields are excluded from `policyHash` on purpose: renaming a policy
must not invalidate the proofs of decisions taken under it.

## Identity — three separate keys

| Level | Who | Technology | Authority |
|---|---|---|---|
| Owner | Human | Privy auth + mera passkey (P256/WebAuthn) | Change policy, suspend, transfer |
| Agent | Software | BIP-44 EOA derived from the owner passkey, or a Privy server wallet | Bounded by policy |
| Attestation | Policy engine | Dedicated key | Signs capsules only; moves no value |

**The attestation key must never be an agent key.** If an agent could sign its
own authorizations the record would prove nothing. Enforced in `attestation.ts`
and again on-chain in `setAttestor()`, which reverts with
`AttestorCannotBeAgentWallet`.

`mera` makes this ergonomic: one owner passkey deterministically derives one key
per agent at `m/44'/60'/0'/0/{derivationIndex}`. No seed phrase, and the
mnemonic still exports cleanly to MetaMask or Rabby.

## Data model

Two rules shape the schema:

1. **`Decision` is append-only.** No code path issues an `UPDATE`. The one
   mutable field is `anchorStatus`, which is metadata about the proof rather
   than about the decision.
2. **`Decision` copies `policyHash` and `policyVersion`** rather than only
   holding a foreign key, so it still proves which policy governed it even if
   the `Policy` row is later lost or tampered with.

`Action` has a required foreign key to `Decision`, so an action cannot exist
without the decision that authorized it. The ordering the product depends on is
enforced by the database, not by discipline.

## Anchoring

Anchoring runs **off the request path**. The decision is computed, signed and
stored before the caller is answered; the chain write follows.

This ordering is deliberate. If a decision only existed once Monad confirmed it,
Monad would be an availability dependency of the security layer — meaning an RPC
outage would either block every agent or, worse, invite a fail-open. Instead the
anchor state is reported honestly in the UI: `PENDING`, `CONFIRMED`, `FAILED` or
`SKIPPED`.

## Storage adapters

The `Repository` interface has two implementations:

- `MemoryRepository` — zero infrastructure. The full product runs with no
  database, which is what makes the end-to-end suite cheap and what lets a judge
  clone the repo and see it work in one command.
- Prisma / PostgreSQL — production, via `DATABASE_URL`.

The interface is deliberately small (agents, policies, decisions, usage
counters, nonces, actions) so the two cannot drift apart.
