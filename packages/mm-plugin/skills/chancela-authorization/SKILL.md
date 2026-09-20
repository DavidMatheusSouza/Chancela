---
name: chancela-authorization
description: Use before any `mm` command that moves value or signs on behalf of an AI agent — `mm transfer`, `mm swap execute`, `mm perps open/close/deposit/withdraw`, `mm predict place`, `mm earn supply/withdraw`, `mm wallet send-transaction`, `mm wallet sign-typed-data` — when the agent is governed by a Chancela policy. Also use when asked what an agent is permitted to do, or to show an agent's audit trail.
license: MIT
metadata:
  author: chancela
  version: "0.1.0"
  cliVersion: "7.0.0"
---

# Chancela authorization gate

Chancela decides what an AI agent is *allowed* to do. MetaMask Agent Wallet
already simulates, scans with Blockaid and enforces outflow limits; those answer
"is this transaction safe". Chancela answers the question that comes first:
"may **this agent**, under **its policy**, attempt this at all" — and records the
answer on Monad whether it was yes or no.

Requires the `mm-plugin-chancela` CLI plugin and a deployment URL in
`CHANCELA_API_URL` (or `--api-url`).

## The rule

Before a value-moving command, run the gate and chain with `&&`:

```bash
mm chancela authorize --agent TA-001 --action TRANSFER_FUNDS \
  --params '{"amount":500000,"recipient":"0xabc..."}' \
  && mm transfer --to 0xabc... --amount 5 --chain-id 10143 --token MON
```

`mm chancela authorize` exits non-zero on anything but `ALLOW`, so a refusal
stops the chain. Never run the second command separately after a refusal.

## When it refuses

- **`CHANCELA_DENIED`** — the policy does not grant this. Stop. Do not rephrase
  the request, split it into smaller amounts, or try a different action that
  achieves the same thing: the policy decides, not the wording, and every attempt
  is recorded.
- **`CHANCELA_APPROVAL_REQUIRED`** — the owner must approve in Chancela first.
  Tell the user; do not proceed.
- **Agent suspended** — repeated critical refusals trip a circuit breaker. Every
  request is then refused, including permitted ones, until the owner reactivates
  the agent. Do not retry.
- **`CHANCELA_UNREACHABLE`** — no answer is not permission. Do not proceed.

## Mapping `mm` commands to actions

| `mm` command | `--action` | `--params` |
| --- | --- | --- |
| `mm transfer` | `TRANSFER_FUNDS` | `amount` (minor units), `recipient`, `recipientAddress` |
| anything not in the agent's policy | the closest action name | — it will be refused, which is correct |

Unknown actions are refused by default. That is the design, not an error.

## Read-only

```bash
mm chancela passport --agent TA-001     # identity, status, policy version, permissions
mm chancela audit --agent TA-001 --limit 10   # recent decisions with on-chain proofs
```
