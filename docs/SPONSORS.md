# Sponsor integrations

Status is stated as **Implemented**, **Partial** or **Planned**. Nothing here
claims a bounty; that is for the judges to decide.

Every entry marked Implemented appears in the code, in the demo, and reports its
real runtime state on `/integrations` — an unconfigured integration says so
there rather than showing a decorative green dot.

---

## Monad — main track

| | |
|---|---|
| Technology | Monad EVM, chain 143 / 10143, viem, Foundry |
| Purpose | Settlement and proof layer for every authorization decision |
| Integration | `packages/contracts`, `apps/web/src/lib/chain.ts` |
| Demo | Every proof link resolves to the explorer |
| Status | **Implemented** |

Monad is load-bearing, not decorative. Anchoring every decision — including the
refusals — requires ~300ms blocks and negligible fees. The architecture would
have to batch into daily Merkle roots on any L1, which would destroy the
per-action provenance the product is selling.

---

## ERC-8004 — Trustless Agents

| | |
|---|---|
| Technology | ERC-8004 Identity Registry (`0x8004A169…`), Reputation Registry (`0x8004BAa1…`) |
| Purpose | Agent identity, bound rather than re-implemented |
| Integration | `TrustAgentPolicyRegistry` reads `ownerOf()` live from the Identity Registry |
| Status | **Implemented** (mainnet addresses; testnet address not published) |

Track 04 lists *"Agent identity and reputation under ERC-8004"* as an example
direction. TrustAgent deliberately does **not** compete with it: identity stays
in the standard registry, and TrustAgent supplies the authorization layer the
standard does not define. The Validation Registry is marked "coming soon" on
Monad; `TrustAgentValidator` is the natural slot for it.

---

## Privy

| | |
|---|---|
| Technology | Auth, embedded wallets, server wallets, policy engine |
| Purpose | Owner authentication; agent keys with key-level policy enforcement |
| Integration | `apps/web/src/app/api/auth/privy/route.ts`, `apps/web/src/app/login/privy-sign-in.tsx` |
| Status | **Implemented** — sign-in live; access token verified server-side |

Privy authenticates; it does not authorize. The access token is verified against
the app secret server-side, the owner address is read out of the verified token
rather than out of the browser, and a verified Privy user who owns no agent is
refused exactly as a wallet signer would be. Nothing in the policy engine
changes when this route is used.

The intended next step is defence in depth: the TrustAgent policy is the
human-readable contract, and Privy's key-level policy mirrors it restrictively.
If TrustAgent is compromised, the key still refuses the transaction.

---

## Envio HyperIndex

| | |
|---|---|
| Technology | HyperIndex → GraphQL |
| Purpose | Indexes registry events for the Trust Activity Explorer |
| Integration | `packages/indexer` (config, schema, handlers); consumed by `/api/agents/:id/activity` |
| Status | **Implemented** — indexer complete; requires a deployed registry address to run |

Without an indexer the "audit trail" is a `SELECT` against the same service that
produced the decisions. With it, the explorer reads the chain independently. The
UI labels its data source either way and never implies on-chain provenance it
does not have.

---

## mera (Monad Foundation)

| | |
|---|---|
| Technology | Passkey (P256 / WebAuthn) → BIP-44 derivation |
| Purpose | One owner passkey derives one key per agent. No seed phrase. |
| Integration | `derivationIndex` on every agent; surfaced on the Agent Passport |
| Status | **Partial** — key model and UI implemented; passkey ceremony not yet wired |

"One passkey, many keys" describes TrustAgent's key model literally. It also
satisfies the track's other listed example — *"passkey-native accounts using
P256 and WebAuthn, with no seed phrase"* — at the same time.

---

## MetaMask Agent Wallet

| | |
|---|---|
| Technology | Agent Wallet plugin (npm package, `mm` CLI) |
| Purpose | Policy checks inside the wallet agents actually use |
| Integration | `packages/mm-plugin` — `passport`, `authorize`, `audit` |
| Status | **Implemented** — plugin and tests complete; not yet published to npm |

Agent Wallet already simulates, scans with Blockaid and enforces outflow limits.
It cannot answer whether *this agent under this policy* may attempt the action at
all. `mm trustagent authorize` exits non-zero on DENY so the wallet aborts rather
than merely printing a warning.

---

## Alibaba Cloud — Qwen 3.8 Max

| | |
|---|---|
| Technology | Model Studio, `response_format: json_schema` with `strict: true` |
| Purpose | Intent extraction |
| Integration | `packages/ai/src/providers/openai-compatible.ts` |
| Status | **Implemented** — requires `QWEN_API_KEY` |

Strict JSON Schema matters here: the intent parser needs guaranteed structured
output, or the Zod gate rejects and the UX breaks.

---

## Kimi (Moonshot)

| | |
|---|---|
| Technology | `api.moonshot.ai/v1`, OpenAI-compatible, `kimi-k2.6` |
| Purpose | Second provider behind the same `AIProvider` interface |
| Integration | `packages/ai/src/providers/openai-compatible.ts` |
| Status | **Implemented** — requires `KIMI_API_KEY` |

Kimi exists in this project to prove a claim: switch the provider
mid-conversation and the authorization decision does not move. Measured across
models, the extracted parameters *can* differ -- one model names a field
`recipient`, another names it `to` -- and the decision is unchanged regardless,
because permission is evaluated before parameters are. The model is replaceable
precisely because it holds no authority.

---

## Groq and OpenRouter — free providers

| | |
|---|---|
| Technology | OpenAI-compatible chat completions |
| Purpose | Real intent extraction, and the provider-swap demonstration, at zero cost |
| Integration | `packages/ai/src/providers/openai-compatible.ts` |
| Status | **Implemented** — Groq verified live against `openai/gpt-oss-120b` |

Neither is a hackathon sponsor and neither is claimed as one. They exist so the
central architectural claim can be demonstrated without a paid key: Kimi has no
permanent free tier, and the point being made was never about a specific vendor.

---

## Nansen

| | |
|---|---|
| Technology | Profiler address-labels API |
| Purpose | Counterparty risk signals feeding the risk engine |
| Integration | `apps/web/src/lib/nansen.ts` |
| Status | **Implemented** — with a local denylist fallback when no key is present |

`Trust Score != Authorization`. Nansen can raise risk and force a human
signature; it can never grant permission. An unreachable API falls back to the
local denylist, never to "all clear".

---

## Not integrated, and why

| Sponsor | Reason |
|---|---|
| Dynamic | Overlaps Privy's role. Using both for the same function without justification would be integration theatre. |
| Chainlink CRE | A plausible fit for scheduled policy revalidation, but not built — it would be scope added for a bounty rather than for the product. |
| Cleanverse | CVI/CVA target payment compliance, not agent authorization. |
| Kuru · Perpl · Agora · Aurora Intents | All require a trading, payments or liquidity product. Building one would contradict the project's scope. |
| Alchemy | `rpc1.monad.xyz` is already Alchemy-operated; swapping the RPC string adds no product value. |
