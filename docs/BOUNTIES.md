# Bounties

Researched against the official Metropolis programme page on **19 September
2026**. Prizes and titles are quoted as published there. Nothing on this page
claims a bounty is won; `Implemented` means the code exists in this repository
and runs.

Anything that could not be confirmed from an official source is marked
**NEEDS VERIFICATION** rather than guessed.

## The programme

| | |
|---|---|
| Format | Six weeks, online, solo or team |
| Build window opened | 1 Sep 2026 |
| **Submission deadline** | **13 Oct 2026** |
| Judging | 14–27 Oct · winners 3 Nov |
| Total pool | $250,000+ |
| Track 04 — Trust, Identity & AI Infrastructure | $30,000 split evenly among 3 teams |
| Grand Champion | $25,000, across all four tracks |
| Eligibility | What is shown on 13 Oct must have been built during the six weeks, and judges must be able to verify it |
| Open source | Encouraged, not required |

**Judging criteria and deliverables — verified** on the authenticated platform on
20 Sep 2026: Technical Execution 20%, Design & Craft (developer experience) 20%,
Originality & Track Insight 15%, Founder & Market Readiness 25%, Traction & Path
Forward 20%. A logo, a public repository, a technical demo video (≤ 3 min, live
product), a pitch video (≤ 2 min) and a live link on mainnet **or testnet** with
test credentials. [SUBMISSION.md](SUBMISSION.md) maps each criterion to where
this repository answers it, and holds the video scripts.

**Still NEEDS VERIFICATION:** whether sponsor bounties need a separate entry, and
who judges them.

## Matrix

`Fit` is judged against one question only, from the project's own decision rule:
does this make Chancela more trustworthy, more verifiable, or more useful for
agent authorization?

| Partner | Bounty | Prize | Fit | State | Pri |
|---|---|---|---|---|---|
| Monad | Track 04 | $10,000 | Core | Registry deployed on 10143, every decision anchored | **P0** |
| Alibaba Cloud | Best Builds with Qwen 3.8 Max | $5,000 credits | Direct | Implemented — needs `QWEN_API_KEY` | **P0** |
| Kimi | Best Builds Powered by KIMI | $3,000 credits | Direct | Implemented — needs `KIMI_API_KEY` | **P0** |
| Privy | "Privy!" | $5,000 | High | Implemented — live sign-in, token verified server-side | **P0** |
| Monad Foundation | Mera: One Passkey, Many Keys | $2,500 | Literal | Implemented — passkey → owner key + one key per agent, verified end to end | **P0** |
| Monad Foundation | Best Mera-Powered UX on Monad | $2,500 | High | Implemented — passkey sign-up creates the account and a first agent in one ceremony | **P0** |
| Nansen AI | Best use of Nansen | $5,000 | High | Implemented — denylist fallback without a key | **P1** |
| MetaMask | Best Agent Wallet Plugin | $2,500 | High | Implemented to the real plugin spec; verified in `mm` 7.0.0; not published to npm | **P0** |
| Envio | Best Use of Envio | $1,000 | High | Implemented — needs codegen and a run | **P1** |
| Dynamic | Best Use of Dynamic | $5,000 | **Re-open** | Declined — see below | **P2** |
| Perpl | Best Analytics / Risk Tool | $3,000 | **Re-open** | Declined — see below | **P2** |
| Kepler Plan (Tencent) | Build with Hunyuan | $2,000 credits | Cheap | **Not previously considered** | **P2** |
| Chainlink | Best workflow with CRE | $3,000 | Weak | Declined — scheduled revalidation is plausible but unbuilt | P3 |
| Alchemy | Best Projects using Alchemy | $1,000 credits | None | Declined — swapping an RPC string adds no product value | P3 |
| Cleanverse | Best Integration of CVI/CVA | $2,000 | None | Declined — payment compliance, not agent authorization | P3 |
| Kuru | Consumer Trading App | $5,000 | None | Declined — would require building a trading product | P3 |
| Kuru | New Assets and Markets | $5,000 | None | Declined — same | P3 |
| Perpl | Best use of Perpl's API | $5,000 | None | Declined — same | P3 |
| Agora | Best Mobile Trading App | $10,000 | None | Declined — same | P3 |
| Agora | Best Cross-Border Payments App | $10,000 | None | Declined — same | P3 |
| Aurora Intents | Any-Chain Liquidity to Monad | $5,000 | None | Declined — liquidity product | P3 |
| Monad Foundation | Best Community Team Project | $5,000 | N/A | Eligibility unknown | **NEEDS VERIFICATION** |

## Three decisions worth re-opening

The earlier sponsor notes were written before the official bounty list was
consulted. Three of them do not survive the comparison.

**Dynamic — $5,000.** Declined as overlapping Privy. But these are two separate
$5,000 bounties, and the project's own rule is only that the wallet provider
must not control authorization. Supporting two providers behind one interface
does not violate that; it demonstrates it. Worth the read.

**Perpl — $3,000, "Best Analytics / Risk Tool".** Declined on the grounds that
Perpl requires a trading product. That reasoning applies to the other Perpl
bounty, not this one — the title asks for a risk tool, and a risk engine is
what this project is. Requirements need reading before declining again.

**Kepler Plan (Tencent), Hunyuan — $2,000 credits.** Absent from the earlier
notes entirely. The `AIProvider` abstraction already exists and already has four
implementations; a fifth is hours of work, and it strengthens the central claim
rather than diluting it — the more providers that reach the same authorization
decision from differently-worded intents, the better the point lands.

## What is blocked on credentials, not code

| Blocked | Worth |
|---|---|
| `QWEN_API_KEY` | $5,000 in credits, and the demo's central beat |
| `KIMI_API_KEY` | $3,000 in credits, and the provider-swap claim |
| `NANSEN_API_KEY` | strengthens an already-implemented integration |

## The rule this page is held to

Two to four deep integrations, not ten shallow ones. A partner is integrated
when it does real work in the product; a logo is not an integration. Every entry
above reports its true runtime state on `/integrations`, and an unconfigured
integration says so there rather than showing a decorative green dot.

## Sources

- Metropolis programme page — <https://monad.xyz/developers/hackathons/metropolis>
- Hackathon platform — <https://hackathon.monad.xyz/>
- Monad testnet network information — <https://docs.monad.xyz/developer-essentials/testnet>
