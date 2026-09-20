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
pnpm --filter @chancela/contracts test   # access control, replay, monotonicity
pnpm --filter @chancela/web test         # capsule forgery, tampering, replay
```

## Reporting a vulnerability

Open a GitHub security advisory rather than a public issue. Include a minimal
reproduction. We will respond before publishing anything.

## Authentication

The owner of an agent is an Ethereum address — it is whatever `ownerOf()`
returns on the ERC-8004 registry. So sign-in proves control of that address
rather than maintaining a parallel account system: authority over a policy is
tied to the same key the chain already recognises.

| Step | Control |
|---|---|
| Challenge | Server-issued nonce, 5-minute TTL, bound to the requesting address |
| Signature | EIP-191 `personal_sign`; the message states plainly that it costs no gas and authorises no transaction |
| Nonce | Burned on first use **and on failure**, so a failed attempt cannot be retried against it |
| Ownership | A valid signature is not enough — the address must own an agent in this deployment |
| Session | Compact HMAC-SHA256 token in an `httpOnly`, `SameSite=Lax` cookie, 12-hour expiry inside the signed payload |
| Gate | Middleware denies by default; only an explicit allowlist is public |

### What stays public, and why

`POST /api/agents/:id/authorize` and `/actions` are deliberately unauthenticated.
They are what other agent runtimes call, and they grant nothing on their own —
`authorize` returns a signed decision that may well be a denial, and `actions`
refuses anything it cannot verify. Putting them behind a browser session would
make Chancela an application instead of infrastructure.

### Two implementation notes worth keeping

**`Secure` is derived from the request scheme, not from `NODE_ENV`.** Tying it to
`NODE_ENV` breaks an ordinary case: `pnpm start` runs in production mode, so
someone evaluating the project on `http://localhost` receives a `Secure` cookie
the browser then refuses to send back — and sign-in fails silently, with no
error anywhere to explain it. A non-local plain-HTTP deployment still gets
`Secure` and still fails, which is the correct outcome.

**Session verification recomputes the HMAC and compares, rather than calling
`crypto.subtle.verify`.** The two are equivalent in principle, but `verify`
behaved differently between the Node and Edge runtimes, and this code runs in
both — middleware on the edge, route handlers in Node. The symptom was a session
that every API route accepted and every page rejected. Comparison is
constant-time, so signature verification does not leak through timing.
