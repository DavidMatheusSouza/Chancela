# mm-plugin-chancela

A [MetaMask Agent Wallet](https://docs.metamask.io/agent-wallet/) CLI plugin that
asks [Chancela](https://github.com/DavidMatheusSouza/Chancela) whether an AI agent
may act, before it acts.

Agent Wallet already simulates transactions, scans them with Blockaid and enforces
outflow limits. Those answer *is this transaction safe*. This plugin adds the
question that comes first — *may this agent, under this policy, attempt it at all* —
answered by a deterministic policy engine, with the answer anchored on Monad
whether it was yes or no.

## Install

The `mm` plugin system is in beta and off by default.

```bash
mm config set experimentalPlugins true
mm plugins install mm-plugin-chancela
export CHANCELA_API_URL=https://your-chancela-deployment
```

The consent screen will show **no capabilities and no data access**. That is
deliberate: a policy gate that cannot touch the wallet is one fewer thing to trust.

## Use it as a gate

`authorize` exits non-zero on anything but `ALLOW`, so it composes with `&&`:

```bash
mm chancela authorize --agent TA-001 --action TRANSFER_FUNDS \
  --params '{"amount":500000,"recipient":"0xabc"}' \
  && mm transfer --to 0xabc --amount 5 --chain-id 10143 --token MON
```

A check that printed a warning and exited 0 would be decorative — the transfer
would run anyway. The non-zero exit is the feature.

| Command | What it does |
| --- | --- |
| `mm chancela authorize --agent --action [--params]` | The decision, its policy version and hash, the audit id and the proof |
| `mm chancela passport --agent` | Identity (ERC-8004), status, policy, granted permissions |
| `mm chancela audit --agent [--limit]` | Recent decisions, refusals included, with transaction hashes |

All three accept `--api-url` and the host's `--json`.

## It fails closed

Unreachable deployment, server error, malformed answer: each is an error and a
non-zero exit. No answer is never treated as permission.

## For agents

`skills/chancela-authorization/SKILL.md` tells an agent when to run the gate and,
as importantly, what not to do after a refusal: not rephrase, not split the amount,
not retry once the circuit breaker has suspended the agent.

## How it was checked

`pnpm test` validates the `mm` block against MetaMask's own `PluginManifestSchema`,
asserts every command extends MetaMask's `PluginCommand`, and mirrors each
install-time rule in the plugin reference by the error it would raise. Beyond
that, the tarball was installed into a real `mm` 7.0.0 with
`mm plugins install file:…` and the commands run against a live deployment.
