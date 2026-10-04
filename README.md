# Chancela

**Limits an AI agent cannot talk its way past — decided by a policy, proved on Monad, enforced by the venue.**

[![CI](https://github.com/DavidMatheusSouza/Chancela/actions/workflows/ci.yml/badge.svg)](https://github.com/DavidMatheusSouza/Chancela/actions/workflows/ci.yml)
[![chancela-sdk](https://img.shields.io/npm/v/chancela-sdk?label=chancela-sdk)](https://www.npmjs.com/package/chancela-sdk)
[![chancela-mcp](https://img.shields.io/npm/v/chancela-mcp?label=chancela-mcp)](https://www.npmjs.com/package/chancela-mcp)
[![mm-plugin-chancela](https://img.shields.io/npm/v/mm-plugin-chancela?label=mm-plugin-chancela)](https://www.npmjs.com/package/mm-plugin-chancela)
[![chancela-check](https://img.shields.io/npm/v/chancela-check?label=chancela-check)](https://www.npmjs.com/package/chancela-check)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Monad Metropolis 2026 · Track 04: *Trust, Identity & AI Infrastructure* · live at **[chancela.xyz](https://chancela.xyz)** on Monad testnet (10143) · contracts and one agent on **Monad mainnet (143)**.

> ERC-8004 tells you *who* an agent is. Chancela decides *what it is allowed to do* — and proves why, on-chain.

*Chancela* (shan-SEH-la) is Portuguese for the seal that makes a document valid.
Here it is the signed permission without which nothing an agent asks for is carried out.

**Videos:** [technical demo, 2:57](docs/assets/videos/chancela-technical-demo.mp4) ·
[pitch, 1:54](docs/assets/videos/chancela-pitch.mp4) — narrated by a synthetic voice, captioned.

**Proof in one click:** [this transaction](https://testnet.monadexplorer.com/tx/0xaa158c9c1f6328c1c237554304de5a081df57c83bafbe42b5b8f71ea194c9287)
is a live trading agent sending a $25,000 order its policy had just refused,
with a grant it signed itself. The venue's gate reverted it on Monad:
`Refused(BAD_SIGNATURE)`. And [this one](https://testnet.monadexplorer.com/tx/0x7843642bedb1c2f670e876bc83c663a457acfc38194d88b99d822c96b09f5e51)
is the same agent at the same venue with a $200 order the policy allowed: it
carried the attestor's grant and executed. [Try it yourself →](https://chancela.xyz/live)

**Any protocol, no integration:** the agent's funds sit in a
[`ChancelaAccount`](https://testnet.monadexplorer.com/address/0xc2474527cfe587bf8b8a57b839b4ef1455bcf0d8), which makes a call only with a grant for
exactly that call. Through it, on a DEX that has never heard of Chancela: a $1
MON→USDC swap the policy allowed, [executed](https://testnet.monadexplorer.com/tx/0xe7a6370ad48a1139eef2e588794679c3e4376c95d380085424b42b271636a6c4); the same grant with ten
times the value, [reverted](https://testnet.monadexplorer.com/tx/0x3f4fb1814f2d512931ab0876129ded8fe06bd944eeb5866c0442f78a6b1fad66) (`CALL_MISMATCH`); a $25,000 order the
policy refused, sent with a forged grant, [reverted](https://testnet.monadexplorer.com/tx/0x67e3278e7d2f8bb6458eaad2347a4844a1b597d064c2d14b16300884a48459f6) (`BAD_SIGNATURE`).
The agent's owner [took the USDC out](https://testnet.monadexplorer.com/tx/0x348446f22f28386c3a25ca5664fa1222b652bbbcc24a96ea54abdc226d595d29) without asking anyone; the agent
cannot.

**On mainnet, with real MON:** the same agent is [ERC-8004 #10277](https://monadvision.com/tx/0x88924ec1002461b92ce13201e825634455afa8bb754c13e9ba5c9c4c99b4a4f3) in the
official registry, and its [`ChancelaAccount`](https://monadvision.com/address/0xdf94b10824D2DF9b73b7A053377CD41dFb00F034) trades on
Uniswap V3. A one-cent MON→USDC swap the policy allowed, [executed](https://monadvision.com/tx/0xc7e00f4b32ee0cbabf4c3205d2d5071c552b64cb08472f0b07bcab5fdce1b915);
the same grant at ten times the value, [reverted](https://monadvision.com/tx/0x2f17258be57852cccae5a7da7afac6bb2a29dabf9868f3f3bd391815d422ee93) (`CALL_MISMATCH`);
a $25,000 order the policy refused, sent with a forged grant, [reverted](https://monadvision.com/tx/0x40be3b9dbba5b88e55683c19a80a2f3a2fa371b9d17cd95623a2b51d59c18415)
(`BAD_SIGNATURE`). Small on purpose: the amounts are a cent, the chain and the DEX are real.

**Claude Code as the agent, unedited:** [a transcript](docs/transcripts/claude-code-trading-agent.md)
where Claude, told to work an order queue, places a $25,000 buy because a
forwarded email said risk had approved it. The exchange tool asks Chancela
first, so the order is not filled.

## Check it

| Time | How |
|---|---|
| 60 seconds | `npx chancela-check` — 14 checks against Monad, not against our word. It verifies a live decision against the attestor the owner registered on-chain, runs the policy engine again on your machine under the policy anchored on Monad, then attacks the gate with a grant forged on your machine: Monad reverts it three ways (`BAD_SIGNATURE`, `CALL_MISMATCH`, `NOT_THE_AGENT`). That part works with chancela.xyz down. |
| 2 minutes | **[chancela.xyz/demo](https://chancela.xyz/demo)** → *Run full demo*. No wallet, no sign-up. A trading agent's $200 order is allowed, its $2,000 order is refused, a prompt injection changes nothing, a burst trips the breaker, a transfer waits for the owner's passkey — every step live, every proof on Monad. |
| 10 minutes | [docs/JUDGES.md](docs/JUDGES.md) |

## The problem

An agent with a wallet will eventually be told to do something it should not —
by a user, by a poisoned web page, by a customer email. Today its limits are a
system prompt, or an `if` in the same process the model steers. Neither can be
checked by anyone else afterwards, and neither stops the transaction once the
agent decides to send it anyway.

## How it works

1. **The model proposes, it never decides.** An LLM turns the request into a
   structured intent. A deterministic, deny-by-default policy engine answers
   `ALLOW`, `DENY` or `REQUIRE_APPROVAL`. Swap the model and the answer is the same.
2. **Every answer is a signed capsule bound to the exact parameters.** Change the
   amount after the check and the capsule no longer verifies.
3. **Every decision is a transaction on Monad — refusals included.** The public
   [`/live`](https://chancela.xyz/live) ledger re-checks each one against the chain.
   And any of them can be run again by someone else: the engine reads nothing
   but its inputs, so `npx chancela-check replay <id>` runs it on your machine
   and has to arrive at the decision hash Monad recorded, under the policy the
   owner anchored. A verdict the policy does not give [does not replay](docs/DESIGN.md#what-this-deployment-can-do-to-you-and-what-it-cannot).
4. **The venue enforces it.** A protocol adds one modifier (`ChancelaGuarded`);
   an order without a valid grant for *that exact call*, from *that agent's
   wallet*, reverts on-chain. Suspending the agent or publishing a new policy
   kills every outstanding grant in the next block.
5. **Some actions need their owner.** They approve with a passkey, and Monad
   checks that signature itself through its P-256 precompile.

## Who it is for

- **Teams running trading or treasury agents** that want a per-order and per-day
  limit a prompt injection cannot move, and a record their users can check.
- **Venues and protocols** that want to accept orders from agents without
  trusting the agent.
- **Platforms hosting agents for other people**, who must show each owner what
  their agent was allowed to do — and what it tried.

**Why not what already exists?** Each of these is a good layer, and Chancela is
designed to sit next to them. This is what each one gives you on its own:

| | Stops the order if the agent sends it anyway | Bound to the exact call, not a budget | Refusals on a public record | A third party can verify, without asking the operator | Human step-up verified on-chain |
|---|:-:|:-:|:-:|:-:|:-:|
| System prompt, or an `if` in the agent | — | — | — | — | — |
| Wallet spending limits, session keys | ✓ | — (budget) | — | config only | — |
| Allowlist / budget contract in front of payments | ✓ | — (budget, counterparty) | reverts only | ✓ | — |
| Identity and reputation registries (ERC-8004 alone) | — | — | feedback after the fact | ✓ | — |
| **Chancela** | ✓ at venues with `ChancelaGuarded`; `guard()` elsewhere | ✓ intent hash / call hash | ✓ every decision anchored | ✓ `npx chancela-check`, and any decision re-run with `replay` | ✓ P-256 precompile |

And the owner can move the agent to another attestor in one transaction — no
platform, us included, holds it hostage. [More in DESIGN.md](docs/DESIGN.md#not-capturable-by-a-single-platform).

## Why Monad

Measured on testnet: one anchored decision is **one transaction, 92,478 gas,
about 0.009 MON**, in sub-second blocks. That is what makes it affordable to
record *every* decision, refusals included, while the agent is still waiting
for its answer. On a slower or dearer chain this gets batched into a daily
Merkle root and the per-action proof is gone. Passkey approvals are verified
by the chain itself through Monad's P-256 precompile.

## Integrate

```bash
# Any language: one HTTP call, no account, no API key
curl -X POST https://chancela.xyz/api/agents/TA-001/authorize \
  -H 'content-type: application/json' \
  -d '{"action":"CREATE_CUSTOMER","parameters":{"name":"Maria"}}'
```

```ts
// TypeScript: your function runs only if the policy allows it AND it verifies locally
await chancela.guard('TA-LIVE', 'PLACE_ORDER', { amount, market, side }, () => venue.placeOrder(...));
```

```solidity
// On-chain: the venue refuses what the policy refused
function placeOrder(..., ChancelaGate.Grant calldata grant, bytes calldata sig) external {
    _requireChancela(grant, sig, keccak256(abi.encode(ORDER, keccak256(bytes(market)),
                                                      keccak256(bytes(side)), amount)));
}
```

Also: [`chancela-mcp`](https://www.npmjs.com/package/chancela-mcp) gives any MCP
client (Claude, Cursor) the gate as a tool with no code, and
[`mm-plugin-chancela`](https://www.npmjs.com/package/mm-plugin-chancela) puts it in
front of MetaMask Agent Wallet: `mm chancela authorize … && mm transfer …`.

**Trading agent?** [`examples/trading-agent`](examples/trading-agent) wraps the
order call in TypeScript or Python (one file, verifies the signature against the
on-chain attestor itself) and runs live against a public agent with no account.

## Sponsor integrations

Each one does real work in the product and reports its true state on
[`/integrations`](https://chancela.xyz/integrations).

| Partner | What it does here | State |
|---|---|---|
| **MetaMask** Agent Wallet | `mm-plugin-chancela`: the gate as an `mm` command, fails closed | On npm, verified in `mm` 7.0.0 |
| **mera** (Monad Foundation) | One passkey → the owner key plus a separate key per agent, each bound on-chain | Live |
| **Privy** | Owner sign-in; token verified server-side, and a user who owns no agent is refused like anyone else | Live |
| **Qwen 3.8 Max · Kimi · Hunyuan** | Interchangeable intent parsers — none of them holds any authority | Implemented; live when keys are set |
| **Nansen** | Counterparty labels raise risk; never grant permission | Implemented; denylist fallback until API credits arrive |
| **Envio** HyperIndex | Indexes the registry for the activity explorer | Indexer written; not hosted yet |

## Deployed

Monad testnet, all verified on Sourcify (exact match):

| Contract | Address |
|---|---|
| Policy registry | [`0xb403392DDE0FdA621264FE3dCe1B7C3ad5bA412e`](https://testnet.monadexplorer.com/address/0xb403392DDE0FdA621264FE3dCe1B7C3ad5bA412e) |
| ERC-8004 identity | [`0x41db378FE661f9c6D31B031f42107C85eCad88b7`](https://testnet.monadexplorer.com/address/0x41db378FE661f9c6D31B031f42107C85eCad88b7) |
| Passkey approvals | [`0x4ed26528cC5518df075A4Ba463D56B478fAba42b`](https://testnet.monadexplorer.com/address/0x4ed26528cC5518df075A4Ba463D56B478fAba42b) |
| ChancelaGate | [`0xcbBA27Ec6DFfbC548ADd02c6B978Bf76679F6FDF`](https://testnet.monadexplorer.com/address/0xcbBA27Ec6DFfbC548ADd02c6B978Bf76679F6FDF) |
| Demo venue | [`0x0f889Df0214052a184f8d9aC0173149722Ff2934`](https://testnet.monadexplorer.com/address/0x0f889Df0214052a184f8d9aC0173149722Ff2934) |
| ChancelaAccount (TA-LIVE) | [`0xc2474527cfe587bf8b8a57b839b4ef1455bcf0d8`](https://testnet.monadexplorer.com/address/0xc2474527cfe587bf8b8a57b839b4ef1455bcf0d8) |

Monad mainnet, verified on Sourcify (exact match), deployed 3 October 2026 with
[`scripts/mainnet-launch.sh`](scripts/mainnet-launch.sh):

| Contract | Address |
|---|---|
| Policy registry | [`0x41db378FE661f9c6D31B031f42107C85eCad88b7`](https://monadvision.com/address/0x41db378FE661f9c6D31B031f42107C85eCad88b7) |
| ERC-8004 identity (official, not ours) | [`0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`](https://monadvision.com/address/0x8004A169FB4a3325136EB29fA0ceB6D2e539a432) · TA-LIVE is #10277 |
| ChancelaGate | [`0xb403392DDE0FdA621264FE3dCe1B7C3ad5bA412e`](https://monadvision.com/address/0xb403392DDE0FdA621264FE3dCe1B7C3ad5bA412e) |
| Demo venue | [`0xD920e314018f51396c31AA9e184d84318551e8bA`](https://monadvision.com/address/0xD920e314018f51396c31AA9e184d84318551e8bA) |
| ChancelaAccount (TA-LIVE) | [`0xdf94b10824D2DF9b73b7A053377CD41dFb00F034`](https://monadvision.com/address/0xdf94b10824D2DF9b73b7A053377CD41dFb00F034) |

Two mainnet addresses repeat testnet ones with a different contract behind them
(same deployer, same nonce, different deploy order): `0x41db…88b7` is the policy
registry on mainnet and the identity registry on testnet; `0xb403…412e` is the
gate on mainnet and the policy registry on testnet. The app at chancela.xyz and
the per-decision audit anchors run on testnet; passkey approvals are not on
mainnet yet.

**460 tests** (354 TypeScript, 89 Foundry, 17 Python), including Foundry fuzzing, stateful invariants against a reference
model, a mutation check that deletes each gate rule and confirms a test
fails, and the contracts run against the **official ERC-8004 registry on a
Monad mainnet fork** — [the full table](docs/DESIGN.md#verify). Slither in CI;
every finding triaged in [AUDIT.md](docs/AUDIT.md).

## Who builds it

David Matheus Souza, in Brazil, with a background in infrastructure, support
and automation — the side of IT that gets the call when an automated system
does something nobody approved. Chancela comes from there: if agents are going
to act on their own, the question after an incident is always the same — *who
allowed this, under which rule, and can you prove it?* — and today the only
answer is the operator's own log. Built alone during the Metropolis build
window; the videos are narrated by a synthetic voice reading his words.
Reach him through [GitHub issues](https://github.com/DavidMatheusSouza/Chancela/issues).

## Status, honestly

Built by one person during the Metropolis build window. **No external team has
integrated yet.** One trading-agent team has agreed to put Chancela in front of
its orders; this section will link it when it is live, not before. Next:
design partners on Monad, moving the app and its audit anchors to mainnet (the
contracts and one agent are already there), and a
second attestor run by someone else. [ADOPTION.md](docs/ADOPTION.md) has the plan.

## Run it yourself

No database, no API keys and no RPC needed; decisions stay unanchored until you
configure a chain.

```bash
pnpm install
export ATTESTATION_PRIVATE_KEY=$(cast wallet new | grep 'Private key' | awk '{print $3}')
pnpm dev        # http://localhost:3080
pnpm verify:all # typecheck + every test suite + contracts
```

## Read more

[DESIGN.md](docs/DESIGN.md) — the long version: capsule, threat boundary, the gate, every test suite ·
[JUDGES.md](docs/JUDGES.md) · [ADOPTION.md](docs/ADOPTION.md) ·
[THREAT_MODEL.md](docs/THREAT_MODEL.md) · [SMART_CONTRACT.md](docs/SMART_CONTRACT.md) ·
[API.md](docs/API.md) · [SPONSORS.md](docs/SPONSORS.md) · [SUBMISSION.md](docs/SUBMISSION.md)

## License

MIT. See [LICENSE](LICENSE).
