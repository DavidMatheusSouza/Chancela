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

## Who adopts it first

The first user is a team that has already given an agent a tool that costs
something when it goes wrong, and has already been asked "what stops it?".

| Who | What goes wrong without it | What they use |
|---|---|---|
| **Trading, treasury and payment agents on Monad** | The model is talked into a transfer; nobody can show afterwards which limit applied | `chancela-sdk` `guard()` around the send, or `mm chancela authorize` in front of MetaMask Agent Wallet |
| **Support and sales agents with write access** | An injected ticket makes the agent refund, delete or email as the company | `chancela-mcp` — one block of MCP config, no code |
| **Platforms that host third-party agents** | "What is this outside agent allowed to do here?" has no answer stronger than an API key | ERC-8004 identity + an anchored policy per agent; the platform verifies capsules, it does not trust them |

What they share: a counterparty — a customer, an auditor, a user whose funds
the agent touches — who will want evidence that is not the company's own log.

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

The offer to agent teams, in the Metropolis Discord and beyond:

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
