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
  ✓ monad   The venue executes only through the gate
            venue 0x0f889D…2934 → gate 0xcbBA27…6FDF; trading agent #4 is wallet 0xA77a6f…235B
  ✓ monad   Forge a grant here and send the agent's $200 order anyway
            Monad reverted: Refused(BAD_SIGNATURE) — signed by 0xA2Bb7c…E40f, not the attestor 0xeaeeD9…9F5F
  ✓ monad   Same grant, order raised to $2,000
            Monad reverted: Refused(CALL_MISMATCH) — the venue hashes the call it actually received
  ✓ monad   Same grant, sent from a wallet that is not the agent
            Monad reverted: Refused(NOT_THE_AGENT) — 0xaa7be1…6Ebd is not 0xA77a6f…235B
  ✓ monad   Are those contracts the published source
            Sourcify: registry exact_match, gate exact_match, venue exact_match

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

## Then it attacks the gate

Signed, recorded decisions do not stop an agent that ignores a refusal and
sends the transaction anyway. [`ChancelaGate`](https://github.com/DavidMatheusSouza/Chancela/blob/main/docs/SMART_CONTRACT.md#chancelagate--no-chancela-no-execution)
does, in the contract that executes — so the last steps try to get past it.

A key is generated on your machine and signs a grant for the live trading
agent's order that is correct in every field but the signer: right venue, right
call, the policy that is live on-chain right now, not expired, never used. The
order is then sent to the demo venue **from the agent's own registered
wallet**, as an `eth_call`, so Monad runs the venue's code exactly as it would
for a transaction. It reverts with `Refused(BAD_SIGNATURE)`. The same grant with
the amount raised reverts with `CALL_MISMATCH`; sent from any other wallet,
`NOT_THE_AGENT`.

No key of ours is involved and nothing is spent. The service is not asked
anything either, so these steps run — and must still refuse — when chancela.xyz
is down. The gate, the venue and the trading agent's token id are compiled in.

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
