# Security

## Controls

| Area | Implementation |
|---|---|
| Input validation | Zod at every boundary, `.strict()` throughout — unknown keys are rejected, not ignored |
| Authorization | Deterministic policy engine, deny by default, single ALLOW path |
| Capsule integrity | EIP-191 signature, intent hash binding, single-use nonce, ≤60s TTL |
| Replay protection | Nonce burned before execution; `decisionHash` uniqueness enforced on-chain |
| Key separation | Attestation key ≠ agent key, enforced off-chain and on-chain |
| Rate limiting | Per agent, per endpoint; fails closed with 429 |
| Transport headers | `nosniff`, `DENY` framing, strict referrer, restrictive permissions policy |
| Secrets | Env vars only; `.gitignore` excludes `.env` and key material; gitleaks in CI |
| Audit | Append-only decisions; both allows and denies anchored |
| On-chain privacy | Hashes, IDs, enums and timestamps only |

## Key handling

Three keys, three purposes, never shared:

| Key | Holds | Never |
|---|---|---|
| `ATTESTATION_PRIVATE_KEY` | Signs capsules | Moves value; is an agent wallet |
| `DEPLOYER_PRIVATE_KEY` | Deploys contracts | Used at runtime |
| Agent wallet key | Agent operations | Signs capsules |

Generate the attestation key with `cast wallet new`. In production use a KMS or
HSM rather than an environment variable; the env-var path in this build is a
hackathon convenience and is documented as such in the threat model.

`setAttestor()` reverts if the attestor equals the registered agent wallet, and
`setAgentWallet()` reverts symmetrically, so the separation cannot be defeated
by ordering the two calls differently.

## What is intentionally not implemented

`TRANSFER_FUNDS` has **no execution backend**. There is no code path in this
repository capable of moving value. This is deliberate: a bug in the policy
engine cannot cost anyone money, and a reviewer can verify the claim by grepping
for the tool's handler and finding a `throw`.

## Running the security suite

```bash
pnpm test:security          # policy engine: injection, invariants, fail-closed
pnpm --filter @trustagent/contracts test   # access control, replay, monotonicity
pnpm --filter @trustagent/web test         # capsule forgery, tampering, replay
```

## Reporting a vulnerability

Open a GitHub security advisory rather than a public issue. Include a minimal
reproduction. We will respond before publishing anything.
