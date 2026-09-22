# chancela-check

Check a [Chancela](https://chancela.xyz) deployment against Monad, in one
command, without an account.

```bash
npx chancela-check
```

```
Chancela — checking https://chancela.xyz for TA-001

  ✓ monad   Whose signature counts for TA-001
            0xeaeeD927…9F5F — set by the token holder, read from 0xb403392D…412e
  ✓ server  Ask to CREATE_CUSTOMER
            ALLOW — OK, audit TA-AUDIT-619AC2A7
  ✓ here    Verify that capsule locally, against the on-chain attestor
            signed by 0xeaeeD927…9F5F, bound to the parameters in hand
  ✓ here    Swap the parameters under that same capsule
            rejected: INTENT_MISMATCH
  ✓ here    Ask to DELETE_CUSTOMER, which the policy does not grant
            DENY — PERMISSION_DENIED; the SDK treats it as "no"
  ✓ monad   Look that decision up in the registry contract
            isDecisionRecorded(0x619ac2a7…) = true
  ✓ monad   Look the refusal up too
            isDecisionRecorded(0xbbce248b…) = true
  ✓ monad   Is that contract the published source
            Sourcify: exact_match

Everything above was answered by Monad or by this machine. The service was
trusted only to reply.
```

## What each column means

The middle column says **who answered**, which is the only thing that makes the
ticks worth reading:

- **monad** — a contract call. Nothing in this repository can change the answer.
- **here** — computed locally, from the capsule the service returned.
- **server** — the deployment's own word. It is used for exactly one thing:
  replying at all.

The registry address is compiled in, not read from the deployment being
checked. A service that could name its own registry could name one whose
`attestorOf()` returns a key it holds, and every signature check below it would
pass. Same reason the ERC-8004 token id comes from the agent id rather than
from the service.

## The step that matters

`Swap the parameters under that same capsule` is the one a boolean `allowed:
true` cannot survive. The capsule commits to an intent hash over the exact
parameters, so a permission granted for `{name: "Judge"}` does not verify for
`{name: "Judge", email: "attacker@example.com"}`. That gap — between what the
model asked for and what the tool runs — is where agent frameworks leak.

## Options

```
npx chancela-check [agentId] [options]

  --url <url>        Deployment to check     (default https://chancela.xyz)
  --rpc <url>        Monad RPC               (default https://testnet-rpc.monad.xyz)
  --registry <addr>  Policy registry         (default 0xb403392D…412e)
  --token-id <n>     ERC-8004 token id       (default: the number in the agent id)
  --no-sourcify      Skip the source-verification lookup
  --json             Machine-readable output
```

Exits non-zero when a check fails, so it can run in the CI of a project that
depends on a deployment it does not control.

## Checking your own deployment

```bash
npx chancela-check my-agent-7 \
  --url https://agents.example.com \
  --registry 0xYourPolicyRegistry
```

The seeded action names (`CREATE_CUSTOMER`, `DELETE_CUSTOMER`) are what the
demo agents' policies grant and refuse; against your own agent, pick an id
whose policy has something comparable.

MIT. Part of [Chancela](https://github.com/DavidMatheusSouza/Chancela) — see
also [`chancela-sdk`](https://www.npmjs.com/package/chancela-sdk) to do this
inside your own code, and [`chancela-mcp`](https://www.npmjs.com/package/chancela-mcp)
to give the gate to an agent as an MCP tool.
