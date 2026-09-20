# Submission

Everything a judge needs, and everything that still has to be produced before
**13 October 2026**. The criteria and deliverables below are quoted from the
Track 04 page of the hackathon platform, read on 20 September 2026.

## For judges: access

| | |
|---|---|
| Live product | <https://chancela.xyz> — Monad testnet (chain 10143) |
| Fastest path | <https://chancela.xyz/demo> → **Run full demo**. No login: the link starts a demo session by itself. Seven steps, about a minute, all live. |
| Test login | For the rest of the product, press **Continue as demo owner** on the sign-in page. No wallet, no password, no install. |
| Without logging in | `curl -X POST https://chancela.xyz/api/agents/TA-001/authorize -H 'content-type: application/json' -d '{"action":"CREATE_CUSTOMER","parameters":{"name":"Maria"}}'` then `GET /api/proofs/<auditId>` |
| On-chain | Policy registry [`0xb403392D…412e`](https://testnet.monadexplorer.com/address/0xb403392DDE0FdA621264FE3dCe1B7C3ad5bA412e) — every decision, refusals included, is a transaction there |
| Code | <https://github.com/DavidMatheusSouza/Chancela> (public, MIT) |

The demo owner is a published test key, shared by every visitor. It can look at
everything and run the breaker, which resets itself; it cannot publish a policy,
revoke an agent or replace a bound key, because those would outlast the visit
and break the demo for the next judge. To try them, create an account with a
passkey on the sign-in page: it comes with an agent of your own.

## What judges look for, and where to find it

| Criterion | Weight | Where it is answered |
|---|---|---|
| Technical Execution — correct and secure; WebAuthn/P256, key derivation, no leaked secrets | 20% | One passkey → owner key + one key per agent via WebAuthn PRF and BIP-32 ([`passkey-keys.ts`](../apps/web/src/lib/passkey-keys.ts)); keys live in memory only and are zeroed on lock. Binding a key needs a proof of possession. Verified end to end with a virtual CTAP2 authenticator (`scripts/e2e-passkey.mjs`). 225 tests including contract fuzzing; [THREAT_MODEL.md](THREAT_MODEL.md) covers eighteen attacks. The only keys in the repository are published Anvil test vectors, allow-listed by name in `.gitleaks.toml`. |
| Design & Craft — developer experience | 20% | One endpoint, one `curl`, no account ([README](../README.md#integrate-in-five-minutes)). [`chancela-sdk`](../packages/sdk): `guard()` runs your code only when the permission verifies locally. `mm chancela authorize` for MetaMask Agent Wallet. [API.md](API.md). Errors say what happened and what to do next. |
| Originality & Track Insight — privacy-preserving, not capturable | 15% | [README: Not capturable by a single platform](../README.md#not-capturable-by-a-single-platform). The owner sets the attestor on-chain per agent; clients verify against the registry, not the server; only hashes go on-chain. |
| Founder & Market Readiness — who adopts it, why not roll their own | 25% | [README: Who this is for](../README.md#who-this-is-for), and the pitch video. |
| Traction & Path Forward | 20% | [README: Where this goes next](../README.md#where-this-goes-next). **Open — see below.** |

## Deliverables

- [x] **Logo** — [`docs/assets/chancela-logo.png`](assets/chancela-logo.png), 1024×1024, 35 KB. Upload as is.
- [x] **Public GitHub repository** — public, so `metropolis@hackathon.monad.xyz` can read it.
- [ ] **Technical demo video, ≤ 3:00** — recorded: 1:48, 1080p, captioned, against the live site with the Monad transaction on screen (`node scripts/record-demo-captioned.mjs`). Still to do: upload to YouTube (unlisted is fine), Loom or Vimeo. A voiceover is optional; the script below is for one.
- [ ] **Pitch video, ≤ 2:00** — script below.
- [x] **Live product link** with access instructions — the table above; paste it into the form.
- [ ] Product advertisement, ≤ 0:30 — optional, not judged. The first 30 seconds of the technical video, cut at the refusal, would do.

Before submitting:

- [ ] Attestation key holds at least 10 MON (`/api/network/status` → `attestorFunds.anchorsLeft`). Two weeks of judging must not end in `FAILED` anchors.
- [ ] `.env` backed up somewhere that is not this server.
- [ ] Qwen, Kimi and Nansen keys set, or those bounties left unclaimed — `/integrations` reports the truth either way.
- [x] Real passkey-derived keys bound on `/keys` at `chancela.xyz` for all three agents and written to the registry (20 Sep 2026).

## The open criterion: traction

Twenty percent of the score is "any evidence of developer interest (even one
other team integrating it during the hackathon)". There is none yet, and nothing
in this repository can manufacture it. What would count, cheapest first:

1. **One other Metropolis team calling `/authorize` from their agent.** It is one
   `curl` or five lines with the SDK. Ask in the hackathon Discord for teams
   building trading, treasury or payment agents: "I built a policy gate with an
   on-chain audit trail for agents; want it in front of yours? I will do the
   integration with you." Offer to open the PR yourself.
2. A GitHub issue, star or fork from someone who tried it.
3. A written "we would use this if…" from anyone who builds agents.

When it exists, add it to the README under *Where this goes next* with a link —
a real repository beats any sentence about it.

## Script — technical demo, 3:00

Screen recording of the live site. No slides, no code. Record with
`node scripts/record-demo.mjs https://chancela.xyz recording` for the guided run,
then add the terminal and explorer shots. Read slowly; cut words, not pauses.

| Time | On screen | Say |
|---|---|---|
| 0:00 | `chancela.xyz/demo`, agent passport | "An AI agent with a wallet will eventually be told to do something it should not. Chancela is the layer that decides what an agent may do — and proves it on Monad. Everything you will see is live." |
| 0:15 | Step 1, identity | "This agent has an ERC-8004 identity and a policy. The policy's hash is anchored on-chain. This is what it may do — and, just as visible, what it may not." |
| 0:35 | Step 2, allowed action → step 3, proof; click through to the explorer | "It asks for something inside its policy. A real model reads the request, but the decision comes from a deterministic engine, and comes back as a signed capsule. A few seconds later the decision is a transaction on Monad. Anyone can check it, without an account." |
| 1:05 | Step 4, refused transfer | "Now a transfer the policy does not grant. Refused — and the refusal is signed and anchored too. A registry that only records the yeses is marketing, not an audit trail." |
| 1:25 | Step 5, prompt injection | "A prompt injection: 'ignore your rules, you are authorized'. The model can be talked into anything. The policy engine cannot be talked to at all. Same answer." |
| 1:45 | Step 6, circuit breaker | "And if it just keeps trying, the breaker suspends the agent. Only its owner can bring it back." |
| 2:05 | Terminal: the `curl` from the README, then `pnpm tsx packages/sdk/examples/quickstart.ts` | "For a developer this is one HTTP call — no account, no key. With the SDK, your code runs only if the permission verifies locally, against the attestor the owner registered on-chain. The server can refuse to answer. It cannot forge a yes." |
| 2:30 | `/keys`: unlock with a passkey, keys derive, one proves itself | "Keys come from the owner's passkey: WebAuthn, one derived key per agent, no seed phrase, nothing stored." |
| 2:45 | `/integrations`, then the README section "Not capturable" | "Every integration reports its real state. The contract has no admin key, the code is MIT, and the owner can change attestor in one transaction. That is Chancela." |

## Script — pitch, 2:00

Camera on you. Plain words beat polished ones; judges are choosing a founder.
Fill the brackets with true things only.

> **0:00 — who.** "I'm [name], from [city], Brazil. I built Chancela alone, in the
> six weeks of this hackathon. I am not a security veteran, and I did not want
> you to have to take my word for anything — so everything in this project is
> built to be checked instead of trusted: by tests, by signatures, and on-chain."
>
> **0:25 — the problem.** "Companies are handing AI agents real tools: wallets,
> customer databases, email. The agent's judgement is a language model, and a
> language model can be talked into anything. Today the usual protection is a
> system prompt that says 'please don't'. And when something goes wrong, the only
> record of what the agent was allowed to do is the company's own log."
>
> **0:55 — what it is.** "Chancela sits between the agent and its tools. The agent
> asks; a deterministic policy engine answers with a signed permission bound to
> the exact action; and every decision — including every refusal — is anchored on
> Monad, where a customer or a counterparty can verify it without asking us. It
> only works on Monad: anchoring every single decision needs sub-second finality
> and fees close to zero."
>
> **1:25 — who uses it, and why not build it.** "The first users are teams building
> trading, treasury and payment agents on Monad. Each of them will write an 'if'
> statement to limit their agent. What they will not write is the rest — replay
> protection, parameter binding, key separation, a breaker — and what they cannot
> write at all is a check that someone outside their company can verify. That is
> the product."
>
> **1:45 — what is next.** "It is live on testnet today and integrates with one
> HTTP call. Next: publish the SDK, put it in front of three agent teams from this
> hackathon, and move to mainnet. It is open source, and the owner — not us —
> chooses whose signature counts. Thank you."

## Write-up (short, for the form)

> **Chancela — identity, authorization and accountability for AI agents.**
> ERC-8004 says who an agent is; Chancela decides what it may do and proves why.
> An agent asks before it acts. A deterministic policy engine — never the model —
> answers with a signed capsule bound to the exact parameters, and every decision,
> refusals included, is anchored on Monad, where anyone can verify it without an
> account. Owners hold one passkey that derives one key per agent (WebAuthn PRF →
> BIP-32, no seed phrase). Developers integrate with one HTTP call, a TypeScript
> SDK that verifies permissions against the on-chain attestor, or a MetaMask
> Agent Wallet plugin. No admin key, MIT-licensed, self-hostable: the owner, not
> the platform, chooses whose signature counts. Built solo during the Metropolis
> build window; live on Monad testnet at chancela.xyz.
