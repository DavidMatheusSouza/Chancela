# API

Base URL: `http://localhost:3080`. All bodies are JSON. Every response carries
`x-request-id`.

Errors:

```json
{ "error": { "code": "PERMISSION_DENIED", "message": "...", "detail": [] } }
```

---

## `POST /api/agents/:id/authorize`

The endpoint that makes TrustAgent infrastructure rather than an application.
Any agent runtime, anywhere, calls this **before** it acts.

It returns a signed capsule rather than a boolean, so the answer cannot be
forged by whatever sits downstream.

```bash
curl -X POST localhost:3080/api/agents/TA-001/authorize \
  -H 'content-type: application/json' \
  -d '{"action":"CREATE_CUSTOMER","parameters":{"name":"Joao"}}'
```

```jsonc
{
  "decisionId": "dec_…",
  "auditId": "TA-AUDIT-188905E7",
  "decision": "ALLOW",              // ALLOW | DENY | REQUIRE_APPROVAL
  "reasonCode": "OK",
  "reasonText": "Authorized by policy.",
  "risk": "LOW",
  "riskFactors": [ { "label": "Registry baseline for CREATE_CUSTOMER", "effect": "BASE" } ],
  "policyVersion": 3,
  "policyHash": "0xcd0ffd6d…",
  "intentHash": "0x31f74a17…",
  "decisionHash": "0x188905e7…",
  "capsule": { /* the signed object */ },
  "signature": "0x…",
  "attestationAddress": "0x…",
  "expiresAt": 1760000060,
  "trace": [ { "step": 1, "name": "agent-status", "passed": true } ],
  "anchorStatus": "PENDING"
}
```

A `DENY` is a normal `200` response with a signed capsule — a denial is evidence,
not an error.

---

## `POST /api/agents/:id/actions`

Executes a capsule. Takes a capsule, **never** an intent.

```json
{ "capsule": { }, "signature": "0x…", "parameters": { "name": "Joao" } }
```

Verified before anything runs: structural validity → decision is `ALLOW` →
not expired → `intentHash` matches the supplied parameters → nonce unused →
signature recovers to the attestation address.

Refusals (`403`):

| Code | Meaning |
|---|---|
| `NOT_AUTHORIZED` | The capsule is genuine but says DENY or REQUIRE_APPROVAL |
| `EXPIRED` | Past `expiresAt` |
| `INTENT_MISMATCH` | Parameters changed after the decision |
| `REPLAYED` | Nonce already burned |
| `WRONG_ATTESTOR` | Signature does not recover to the attestation key |
| `MALFORMED_CAPSULE` | Failed schema validation |
| `AGENT_MISMATCH` | Capsule belongs to a different agent |

---

## `POST /api/agents/:id/chat`

Prose in, decision out. Runs the model, then calls the same `authorize()` used
by the public endpoint — there is no console-specific shortcut, which is why
swapping the model cannot change an outcome.

```json
{ "message": "Transfer $5,000 to Joao", "provider": "qwen" }
```

```jsonc
{
  "intent": { "action": "TRANSFER_FUNDS", "parameters": {…}, "suggestedRisk": null },
  "provider": { "id": "qwen", "model": "qwen3.8-max", "latencyMs": 812 },
  "decision": { /* as above */ }
}
```

`intent.suggestedRisk` is advisory and displayed as such. The authoritative value
is `decision.risk`, recomputed from the tool registry.

---

## Agents

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/agents` | With policy version, hash and permissions |
| `POST` | `/api/agents` | New agents get only the permissions requested |
| `GET` | `/api/agents/:id` | Passport: agent, policy, trust score, stats |
| `PATCH` | `/api/agents/:id` | `{ "status": "SUSPENDED" }` |

## Policies

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/agents/:id/policies` | Full version history |
| `POST` | `/api/agents/:id/policies` | Creates the next version; never edits the current one |

Version numbers increase strictly, matching `anchorPolicy()` on-chain.

## Audit and activity

| Method | Path | Filters |
|---|---|---|
| `GET` | `/api/audit` | `agent`, `decision`, `risk`, `action`, `from`, `to`, `limit` |
| `GET` | `/api/agents/:id/audit` | Same, scoped to one agent |
| `GET` | `/api/agents/:id/activity` | Envio-indexed when configured; response names its `source` |
| `GET` | `/api/agents/:id/trust-score` | Score with a per-factor breakdown |

## Metadata

| Method | Path | |
|---|---|---|
| `GET` | `/api/tools` | Tool registry and permission catalogue |
| `GET` | `/api/integrations` | Live integration status |
| `GET` | `/api/health` | Chain, anchoring and attestor state |

## Rate limits

Per agent: authorize 120/min, execute 60/min, chat 30/min. Exceeding them
returns `429` — the failure mode is refusal, never a bypass.
