# Put Chancela in front of a trading agent

For a team that already has an agent placing orders — on Kuru, Clober, a CEX,
anything — and wants the order that should not happen to not happen, with a
record a third party can check.

The change to your agent is one call, wrapped around the line that sends the
order. Everything below runs today against [chancela.xyz](https://chancela.xyz)
and Monad testnet, with **no account and no key**, using `TA-LIVE`: a public
trading agent whose owner allows orders up to $500 each and nothing that moves
funds out.

## 1. See it answer (1 minute, any language)

```bash
curl -s https://chancela.xyz/api/agents/TA-LIVE/authorize \
  -H 'content-type: application/json' \
  -d '{"action":"PLACE_ORDER","parameters":{"amount":200000,"market":"MON/USDC","side":"BUY","orderType":"MARKET"}}' \
  | jq '{decision, reasonCode, auditId}'
```

```json
{ "decision": "DENY", "reasonCode": "LIMIT_EXCEEDED", "auditId": "TA-AUDIT-…" }
```

A $2,000 order against a $500 limit. The refusal is signed, stored and anchored
on Monad; open `https://chancela.xyz/proof/<auditId>` to see it re-checked
against the chain. Change `amount` to `20000` ($200) and the answer is `ALLOW`.

Plain HTTP is enough to *ask*. To not have to *trust the answer*, verify it —
the two clients below do that locally in a few lines.

## 2. Wrap your order call

### Python — [`chancela.py`](chancela.py), one file, one dependency

```bash
pip install eth-account
python demo.py
```

```python
from chancela import Chancela, ChancelaError

chancela = Chancela(token_ids={"TA-LIVE": 4})   # your agent id -> its ERC-8004 token id

def place_order(order):
    return chancela.guard("TA-LIVE", "PLACE_ORDER", order,
                          lambda decision: exchange.place(**order))   # runs only if allowed AND verified
```

### TypeScript — `chancela-sdk` on npm

```bash
npm install chancela-sdk viem
pnpm tsx examples/trading-agent/guard-order.ts     # from this repo
```

```ts
const placeOrder = (order: Order) =>
  chancela.guard('TA-LIVE', 'PLACE_ORDER', { ...order }, () => exchange.place(order));
```

Both demos print the same three lines, live:

```text
$200 order   : sent BUY MON/USDC $200.00
$2,000 order : NOT SENT -- DENIED: … Value exceeds the maximum allowed by this policy. (LIMIT_EXCEEDED)
swapped order: ALLOW for $200, then INTENT_MISMATCH for $20,000
```

The third line is the one a policy check written in-house does not give you:
the permission is bound to the hash of the exact order, so if anything between
the check and the send changes it — a bug, a second prompt, a compromised
dependency — the permission no longer verifies and the order is not sent.

### What `guard` checks before your function runs

1. The policy said `ALLOW` (not `DENY`, not `REQUIRE_APPROVAL`).
2. The capsule is for this agent and this action.
3. Its intent hash equals the hash of the order **you are about to send**.
4. It has not expired (60 seconds).
5. It is signed by the attestor that the agent's owner registered in the
   [policy registry on Monad](https://testnet.monadexplorer.com/address/0xb403392DDE0FdA621264FE3dCe1B7C3ad5bA412e)
   — read from the chain, not from the server that answered.

Anything else — refused, needs approval, server unreachable, malformed answer,
wrong signer — raises, and your function is never called. **No answer is never
permission.**

## 3. The order parameters

`PLACE_ORDER` takes exactly these fields. Send the same object you hash: no
extra fields, no defaults filled in later, or the hash will not match.

| Field | Type | |
|---|---|---|
| `amount` | integer | Order notional **in cents**. This is what the limits count. |
| `market` | string | e.g. `"MON/USDC"` |
| `side` | `"BUY"` \| `"SELL"` | |
| `orderType` | `"MARKET"` \| `"LIMIT"` | optional; `LIMIT` needs `price` |
| `size`, `price` | decimal **string** | optional; never a float |
| `currency` | 3 letters | optional |
| `venue` | string | optional, e.g. `"kuru"` |
| `marketAddress` | address | optional; checked against the policy's blocked counterparties |
| `clientOrderId` | string | optional; your own id, useful for matching the audit log to fills |

### Buying an evaluation

An agent that buys a trading evaluation (a funded-account challenge) for its
user asks with `BUY_ASSESSMENT`. The price counts against the same
per-transaction ceiling and daily cap as an order; the size of the account it
unlocks does not.

```bash
curl -s https://chancela.xyz/api/agents/<your-agent>/authorize \
  -H 'content-type: application/json' \
  -d '{"action":"BUY_ASSESSMENT","parameters":{"amount":9900,"plan":"25K-1STEP","accountSize":2500000}}'
```

| Field | Type | |
|---|---|---|
| `amount` | integer | Price **in cents**. The only required field, and what the limits count. |
| `plan` | string | optional; the evaluation, as the seller names it |
| `accountSize` | integer | optional; the account it unlocks, in cents |
| `provider` | string | optional |
| `currency` | 3 letters | optional |
| `recipientAddress` | address | optional; who is paid on-chain, checked against the policy's blocked counterparties |
| `clientOrderId`, `memo` | string | optional |

The policy has to grant `BUY_ASSESSMENT`; an agent that may place orders may not
buy anything until its owner says so. When a request is refused with
`INVALID_PARAMETERS`, the last step of `trace` in the answer names the field:
`"amount: Required"`, `"unknown parameter: leverage"`.

## 4. What the owner controls

The policy lives with the owner, not in the agent's prompt, so the model cannot
talk its way out of it:

- **Per-order ceiling** (`maxTransactionValue`) and **daily notional cap**
  (`dailyValueCap`), in cents. The daily cap counts every allowed order.
- **Orders per day** (`dailyTransactions`).
- **Blocked counterparties** — market or router contracts the agent may never touch.
- **Trading hours** (UTC window) and allowed environments.
- **Step-up**: orders above 80% of the per-order ceiling are CRITICAL; with the
  threshold at CRITICAL they go to the owner's passkey instead of the market,
  and the approval is verified on-chain by `ChancelaApprovals`.
- **Suspend** the agent in one click; a breaker suspends it by itself after
  repeated refused attempts.

Every change is a new, hash-anchored policy version — nobody can quietly loosen
it afterwards, including us.

## 5. Your own agent (about 10 minutes, with us)

1. Send us four things: the **owner address** (the wallet that will control the
   policy), the **wallet the agent trades from**, the **markets** it trades, and
   the **limits** you want to start with (per order, per day, orders per day).
2. We create the agent, register its ERC-8004 identity to the owner, and anchor
   its first policy on Monad. You get back the agent id and its token id.
3. Replace `TA-LIVE` and the token id in the snippet above. Done — your agent
   now asks before every order.
4. The owner signs in at [chancela.xyz/login](https://chancela.xyz/login) with
   that wallet to see every decision, change the limits (each change is a new
   anchored version) or suspend the agent.

Prefer not to depend on our server at all? Everything is MIT:
`docker compose up`, then point your agent's attestor at your own key with
`setAttestor()` on the registry. Your identity, policy history and audit trail
stay yours.

## 6. Show your users the limits are real

Once your agent is registered, it has a seal you can put on your own site: an
image, redrawn on every request, with its status, ERC-8004 identity, the policy
version in force and how many requests were refused. It goes red within a
minute if the agent is suspended.

```html
<a href="https://chancela.xyz/agents/TA-XXX"><img src="https://chancela.xyz/seal/TA-XXX.svg" width="360" height="116" alt="Chancela seal"></a>
```

Keep the link: the image is a pointer, and the passport it opens is where the
registry on Monad is read again. `?style=badge` is the one-line form.

## With an LLM agent over MCP

Put `guard()` inside the tool, not in the prompt.
[`packages/mcp/examples/exchange-server.ts`](../../packages/mcp/examples/exchange-server.ts)
is a paper exchange whose `place_order` tool asks Chancela and verifies the
answer before it fills anything, so the model has no permission step it could
skip. [`claude-code-session.sh`](claude-code-session.sh) runs Claude Code as the
agent against it; the [unedited transcript](../../docs/transcripts/claude-code-trading-agent.md)
shows Claude attempting a $25,000 order on a forged "exception" and the tool
refusing it.

## Handling the answers

| Outcome | What your agent should do |
|---|---|
| `ALLOW` + verifies | Send the order — exactly the one you asked about. |
| `DENY` | Don't send. Log `reasonCode` and `auditId`; if the order came from a model, tell it the reason so it stops retrying. |
| `REQUIRE_APPROVAL` | Don't send now. The response has `approval.url`; poll it (public, `GET`) and once the owner approves it carries a signed `ALLOW` capsule. |
| `UNREACHABLE` / `HTTP_*` / `UNVERIFIED_*` | Don't send. Retry later if you like; never fall back to sending. |
| `RATE_LIMITED` | 120 authorizations per minute per agent. Don't send; back off. |

## Questions, integration help

Open an issue on [DavidMatheusSouza/Chancela](https://github.com/DavidMatheusSouza/Chancela/issues)
— we write the integration PR with you if you want. What we ask in return is a
link to it and an honest note, good or bad, for [ADOPTION.md](../../docs/ADOPTION.md).
