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
direction. Chancela deliberately does **not** compete with it: identity stays
in the standard registry, and Chancela supplies the authorization layer the
standard does not define. The Validation Registry is marked "coming soon" on
Monad; `ChancelaValidator` is the natural slot for it.

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

The intended next step is defence in depth: the Chancela policy is the
human-readable contract, and Privy's key-level policy mirrors it restrictively.
If Chancela is compromised, the key still refuses the transaction.

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
| Technology | `@category-labs/mera` — WebAuthn PRF → BIP-32, in the browser |
| Purpose | One owner passkey derives the owner key and one key per agent. No seed phrase. |
| Integration | `apps/web/src/lib/passkey-keys.ts`, `/login`, `/keys`, `POST /api/auth/passkey` |
| Status | **Implemented** — verified end to end with a virtual CTAP2 authenticator (`scripts/e2e-passkey.mjs`) and on real hardware: Chrome on Windows with a Google Password Manager passkey, 20 Sep 2026 |

"One passkey, many keys" is this project's key model stated literally, so the
integration is the model made real rather than a feature bolted on:

- **Sign up and sign in with a passkey.** The PRF output seeds BIP-32; the owner
  key at `m/44'/60'/1'/0/0` signs the same SIWE challenge a wallet would and is
  zeroed immediately after. The server sees a signature, never a passkey. A new
  owner gets one starter agent with a single read permission — onboarding in
  seconds, with deny-by-default intact.
- **One key per agent** at `m/44'/60'/0'/0/{index}`, the path the Agent Passport
  has always displayed. `/keys` derives them on unlock, lets each prove itself by
  signing a message verified on the spot, and zeroes them on lock or navigation.
- **Binding needs proof of possession.** The server stores a derived address as
  an agent's wallet only after verifying a signature from that key naming both
  the address and the agent, so it cannot be replayed or pointed at a key the
  owner does not hold.

The status on `/integrations` is read from the store — it says connected only
when a key has actually been bound. It was previously an environment flag, which
is the decorative green dot this document promises not to have.

**Live.** The three demo agents hold real passkey-derived keys, bound with a
proof of possession and written to the registry:
[TA-001](https://testnet.monadexplorer.com/tx/0xb4544683b29b68a299cf05d6d383c2518f78540a0ef0c9fcb07be913f0496506),
[TA-002](https://testnet.monadexplorer.com/tx/0x129dd0d7c98f022ae52f1d3483a3cc9c6f0709acf125e34ec71725b0cb6576f1),
[TA-003](https://testnet.monadexplorer.com/tx/0x2ec2437c96df7e0c5f7fe0b7f29c3353b2716a0bcbeec19f63c0dd50200ae930).
Each passport compares its bound address with `agentWalletOf()` and shows
*in registry*.

**On-chain.** A bound key reaches the registry through
`scripts/sync-agent-wallets.ts`, which calls `setAgentWallet()` with the token
owner's key -- by hand, because that key is never loaded by the running service.
The passport and `GET /api/agents/:id` then compare the bound address with
`agentWalletOf()` and say whether the registry agrees, so the binding is
checkable without trusting this deployment.

**Not done, and not by accident:** a derived agent key does not anchor
decisions and never will. The registry rejects an attestor that equals the
agent's wallet, because an agent that signs its own authorizations proves
nothing. What a derived key *could* sign is the agent's own transactions, but it
exists only in the owner's browser while `/keys` is unlocked, it holds no gas,
and nothing in this repository moves value to give it any. An autonomous agent
cannot use a key that needs its owner's fingerprint; that is the honest limit of
passkey-derived agent keys, not a missing feature.

---

## MetaMask Agent Wallet

| | |
|---|---|
| Technology | `mm` CLI plugin (oclif, `@metamask/agent-wallet/plugin`), plus an agent skill |
| Purpose | A policy gate in front of the wallet agents actually use |
| Integration | `packages/mm-plugin` — `mm chancela authorize`, `passport`, `audit` |
| Status | **Implemented** — installed into a real `mm` 7.0.0 and run against a live deployment; published as [`mm-plugin-chancela`](https://www.npmjs.com/package/mm-plugin-chancela) |

Agent Wallet already simulates, scans with Blockaid and enforces outflow limits.
It cannot answer whether *this agent under this policy* may attempt the action at
all. `mm chancela authorize` exits non-zero on anything but ALLOW, so it composes
as `mm chancela authorize … && mm transfer …` and a refusal stops the chain. It
also fails closed: an unreachable deployment is an error, never permission.

The plugin requests **no capabilities and no data access**. A policy gate that
cannot itself touch the wallet is one fewer thing to trust, and it is what the
consent screen shows.

An earlier version of this package was written against an API that does not
exist — a `createPlugin()` factory and `mm <vendor>` subcommands, neither of which
the CLI has. It was rebuilt from MetaMask's plugin reference: a `mm` manifest
block, a prebuilt `oclif.manifest.json`, commands extending `PluginCommand`, no
oclif hooks. The tests validate against MetaMask's own `PluginManifestSchema` and
base class, one test per install-time error.

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
| Technology | Profiler address-labels API (`POST /api/v1/profiler/address/labels`, chain `monad`) |
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
