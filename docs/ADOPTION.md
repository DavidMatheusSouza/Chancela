# Adoption

Who puts Chancela in front of their agent, how long it takes them, and what we
are doing to get the first ones. Where something has not happened yet, this
page says so.

## Status, plainly

- **Integrations by other teams: none yet.** When one exists it is linked here,
  repository and all. Until then this section stays at the top.
- **Packages on npm:** [`chancela-sdk`](https://www.npmjs.com/package/chancela-sdk),
  [`chancela-mcp`](https://www.npmjs.com/package/chancela-mcp),
  [`mm-plugin-chancela`](https://www.npmjs.com/package/mm-plugin-chancela),
  published 20 September 2026. Download counts from the first days after a
  publish are mostly registry mirrors, so we do not quote them as interest.
- **Live deployment:** [chancela.xyz](https://chancela.xyz), Monad testnet, open
  to anyone without an account.

## Who adopts it first, on Monad

Named, in the order we are going after them. None of them has been contacted
yet; this is the plan, written down so it can be checked against what happens.

### 1. Monad's Agent Hub — the platform that hands out agents

Monad [launched Agent Hub](https://www.gate.com/en-us/news/detail/monad-launches-agent-hub-for-ai-agent-deployment-on-its-ecosystem-17803229)
on 9 July 2026: deploy an AI agent in one click and let it act across the
ecosystem through "DApp Skills".

A one-click agent is a standing authorisation given to someone who did not read
what it authorises. The first time one of them is talked into a bad trade or a
transfer, the platform that deployed it is the one asked what stopped it.

- **What they integrate:** one `authorize` call before a Skill executes — the
  MCP server does it with no code, `guard()` in five lines. Each deployed agent
  gets an ERC-8004 identity and a default policy: which Skills it may call, the
  most it may move per action and per day, and the risk above which its owner
  approves with a passkey.
- **What they get that they cannot build:** a record their users can check
  without trusting the platform. "Agent Hub says the agent was within its
  limits" is the platform's word; a policy hash and a decision anchored on
  Monad, re-checkable with `npx chancela-check`, is not.

### 2. Trading agents on Monad's on-chain orderbooks

[Kuru](https://docs.kuru.io/) and Clober run fully on-chain order books on
Monad, which is where an autonomous trading agent spends its money. The owner of
such an agent is the person who loses when the model misreads a message.

- **What they integrate:** `guard()` around the call that places the order,
  with the `PLACE_ORDER` action (`amount` is the order notional in cents;
  `market`, `side`, and optionally `size`, `price`, `marketAddress`).
  The policy caps each order and the day's total (`maxTransactionValue`,
  `dailyValueCap`), limits how many value-moving actions run per day, blocks
  known-bad counterparties, and sends anything above the step-up threshold to
  the owner's passkey — verified on-chain by `ChancelaApprovals`.
- **Why this and not a kill switch:** a kill switch stops an agent after
  someone notices. The gate refuses the one order that should not happen, and
  the agent keeps trading within its limits.

### 3. Agents on MetaMask Agent Wallet

Already shipped: `mm plugins install mm-plugin-chancela`, then
`mm chancela authorize … && mm transfer …`. A non-zero exit on refusal, so the
wallet never sends. The cheapest integration on this list — no code at all.

### 4. Any team whose agent writes to something that matters

Support and sales agents with refund, delete or email-as-the-company tools, on
any chain or none. An injected ticket is the attack; `chancela-mcp` is one block
of configuration in Claude, Cursor or any MCP client, and
[`packages/mcp/examples/support-agent.ts`](../packages/mcp/examples/support-agent.ts)
shows the model being talked into a transfer and the transfer not happening.

What all four share: a counterparty — a user, an auditor, a customer — who will
want evidence that is not the operator's own log.

## How long it takes

Measured from "I have an agent" to "it asks first", with the published packages:

| Path | Effort | What the integrator writes |
|---|---|---|
| HTTP | 1 minute | One `POST /api/agents/:id/authorize` before the action. No account, no key. |
| MCP (Claude, Cursor, any MCP client) | 2 minutes | A config block with `npx -y chancela-mcp`. The model gets a `chancela_authorize` tool whose description tells it what to do after a refusal. |
| MetaMask Agent Wallet | 2 minutes | `mm plugins install mm-plugin-chancela`, then `mm chancela authorize … && mm transfer …` |
| TypeScript SDK | 5 minutes | `chancela.guard(agent, action, params, () => doIt())` — the function runs only if the permission verifies locally against the on-chain attestor |
| Self-hosted | 30 minutes | `docker compose up`, MIT, no call home. Point the agent's attestor at your own key with `setAttestor()`. |

A worked example of the MCP path, against an agent nobody wrote for the demo,
is [`packages/mcp/examples/support-agent.ts`](../packages/mcp/examples/support-agent.ts).

## Why not write it themselves

Every team writes the first version: an `if` before the tool call. What they do
not write, because it only matters after something has gone wrong:

- binding the permission to the exact parameters, so nothing is swapped after the check;
- nonces and a sixty-second expiry, so a permission cannot be replayed;
- a signing key the agent never holds;
- recording the refusals, not just the actions;
- policy versions that cannot be rolled back quietly;
- a breaker for the agent that just keeps trying.

[THREAT_MODEL.md](THREAT_MODEL.md) lists eighteen attacks of this kind. And the
home-grown version has one limit no amount of work removes: **nobody outside the
company can verify it.** A policy hash and a decision anchored on Monad can be
checked by a counterparty without asking anyone.

## Getting the first three

In order: agent teams in the Metropolis hackathon itself (they are building
now, and one integration during judging is worth more than any plan), then
builders deploying through Agent Hub, then trading-agent teams on Kuru and
Clober. The offer is the same to all of them:

> I built a policy gate with an on-chain audit trail for AI agents. If your
> agent moves funds or writes to anything that matters, I will put Chancela in
> front of it with you — I open the PR — in exchange for an honest account of
> where it chafes.

What a design partner gets: a policy written with them, their agents registered
under their own ERC-8004 identities, a public audit page they can show their
users, and the option to take the attestor in-house at any time.

What we ask for: a link to the integration, and a short written note — good or
bad — that goes on this page as is.

Progress on that list is recorded here, with dates, as it happens.

## How it sustains itself

The protocol is and stays open: MIT code, a registry contract with no admin,
and an attestor the agent's owner can replace in one transaction. So the thing
that can be sold is not access; it is **running the attestor well**:

- **Self-hosted — free.** Everything in this repository, forever.
- **Hosted attestor.** We run the signing key, the anchoring and the monitoring;
  priced per anchored decision. On Monad testnet an anchor costs about
  0.01 MON, which is what makes per-decision pricing possible at all.
- **Private attestor for platforms.** A dedicated key and deployment for a
  platform that hosts many agents, with audit exports for its compliance team.

The constraint we hold ourselves to: nothing in the paid tiers can make an agent
dependent on us. An owner who leaves takes their identity, policy history and
audit trail with them, because none of it was ever ours.

## Roadmap

1. ~~Publish the packages~~ — done, 20 September 2026.
2. **Three design partners** — see above.
3. **Policy templates** for treasury, support and sales, so a sane default is
   one click instead of a JSON document.
4. **Mainnet.** The code switches on chain id; the ERC-8004 mainnet registry
   exists. Missing: a funded attestor.
5. **A second, independent attestor** run by someone else — the point where
   "not capturable" stops being a design property and becomes a fact.
