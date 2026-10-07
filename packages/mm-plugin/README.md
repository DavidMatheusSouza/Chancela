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

**If the plugin is gone right after it installs.** On `mm` 7.0.0 installed from
npm, `mm plugins install <name>` prints `installed v0.1.0` and then
`Uninstalling … done`, with no error, and `mm plugins` lists nothing. The CLI's
own post-install check looks for the new plugin on a configuration object that
was replaced while the install ran, does not find it, and removes it; with
`DEBUG=oclif:*` it reports `PLUGIN_MANIFEST_FILE_MISSING`, although the package
ships `oclif.manifest.json`. That check reads nothing from the plugin's own
package, so it should not be specific to this one; this is the only plugin it
was tried with. Reproduced on 7 Oct 2026 with Node 22.23 on Linux. Installing the same published tarball from
a file takes the other branch of that check and works:

```bash
npm pack mm-plugin-chancela
mm config set experimentalAllowUnverifiedInstalls true
mm plugins install "file:$(pwd)/mm-plugin-chancela-0.1.0.tgz" --accept-permissions
mm chancela passport --agent TA-001 --api-url https://chancela.xyz
```

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
`mm plugins install file:…` and the commands run against a live deployment —
again on 7 Oct 2026, from the tarball published on npm: `passport`, `audit`, an
`authorize` that was anchored on Monad, and a refusal to proceed when the
deployment cannot be reached.
