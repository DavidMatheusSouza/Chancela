# Deployment

## Local, zero infrastructure

```bash
pnpm install
export ATTESTATION_PRIVATE_KEY=0x...   # cast wallet new
pnpm dev                               # http://localhost:3080
```

No database, no RPC and no API keys required. Seeded demo agents, deterministic
intent parser, decisions recorded with `anchorStatus: SKIPPED`.

## Docker

```bash
cp .env.example .env
docker compose up --build
```

Postgres is namespaced (`chancela-db`, volume `chancela-pgdata`) and bound to
`127.0.0.1:5442` so it cannot collide with anything else on a shared host.

## Contracts

```bash
cd packages/contracts
export DEPLOYER_PRIVATE_KEY=0x...
export ERC8004_IDENTITY_REGISTRY=0x...   # required on testnet
export MONAD_TESTNET_RPC_URL=https://testnet-rpc.monad.xyz

pnpm deploy:testnet
```

Then set `POLICY_REGISTRY_ADDRESS` in `.env` and restart the app. `/api/health`
should report `"anchoring": "enabled"`.

Mainnet deployment uses `pnpm deploy:mainnet`, which also verifies on Monadscan.

## Indexer

```bash
cd packages/indexer
# put the deployed registry address in config.yaml
pnpm codegen && pnpm dev
export ENVIO_GRAPHQL_URL=http://localhost:8080/v1/graphql
```

## VPS

### Shared hosts

If the box already runs other services — the common case:

- **Give Chancela its own database, its own role and its own port.** Never
  reuse an existing cluster's credentials or database.
- Prefer full container isolation via `docker compose`, which the compose file
  already namespaces.
- Choose a free port explicitly: `WEB_PORT=3080 DB_PORT=5442 docker compose up -d`.

### Postgres without Docker

Docker is the intended path and `docker-compose.yml` already namespaces the
database. On a host where Docker is not installed and you are not root -- the
common case for a shared hackathon VPS -- there is a second route:

```bash
./scripts/dev-postgres.sh        # initdb + start, using the system binaries
# put the printed DATABASE_URL in .env
pnpm db:push
```

It creates a cluster that belongs entirely to this project: its own data
directory beside the repository, its own role and database, and a port bound to
loopback only. It never touches an existing cluster, and it refuses to
initialise if something is already listening on the port rather than guessing.

`/api/health` reports `"storage": "postgres"` once the app is pointed at it, and
`"memory (not durable)"` when it is not.

### Daily work-in-progress commits

```bash
./scripts/daily-commit.sh          # run it by hand
crontab -l | grep daily-commit     # it is scheduled at 22:00
```

It commits only when something actually changed. There are no empty
commits, and nothing is backdated: the history says when the work
happened, which is the only thing that makes it worth reading.

### Without root

Everything here runs in user space. Foundry installs to `~/.foundry`; the package
scripts already prepend it to `PATH`.

> Note: `anvil` requires glibc ≥ 2.35. On older hosts (RHEL 9 ships 2.34) it will
> not run. `forge build` and `forge test` are unaffected — they use an internal
> EVM — and deployment goes straight to a remote RPC, so a local node is not
> needed.

### Exposure via Cloudflare Tunnel

Preferred over opening ports:

```yaml
# ~/.cloudflared/config.yml
tunnel: <tunnel-id>
credentials-file: /home/<user>/.cloudflared/<tunnel-id>.json
ingress:
  - hostname: chancela.example.com
    service: http://127.0.0.1:3080
  - service: http_status:404
```

```bash
cloudflared tunnel route dns <tunnel-id> chancela.example.com
cloudflared tunnel run <tunnel-id>
```

TLS terminates at Cloudflare, so no certificate management and no inbound ports.

## Production checklist

- [ ] `ATTESTATION_PRIVATE_KEY` in a KMS/HSM, not an environment variable
- [ ] Attestation key funded with MON for anchoring — `/api/network/status` → `attestorFunds.anchorsLeft`; keep it above one day of `ANCHOR_MAX_PER_DAY`
- [ ] `setAttestor()` called on-chain for every agent
- [ ] `setAgentWallet()` called, so the attestor/agent separation is enforced
- [ ] After binding passkey-derived keys on `/keys`: `pnpm tsx scripts/sync-agent-wallets.ts --send`, until every passport shows the wallet as *in registry*
- [ ] Every agent's policy anchored via `anchorPolicy()`
- [ ] `DATABASE_URL` set and `prisma migrate deploy` run
- [ ] The database starts by itself after a reboot. With the user-space cluster that is one crontab line: `@reboot /usr/pgsql-16/bin/pg_ctl -D <PGROOT>/data -l <PGROOT>/server.log start`
- [ ] `.env` backed up somewhere that is not this server — it holds the only copy of the attestation and deployer keys
- [ ] `/api/health` reports `anchoring: enabled`
- [ ] `/integrations` reviewed — every entry reports its real state
- [ ] `gitleaks` clean

## Health

```bash
curl -s localhost:3080/api/health
# {"status":"ok","chain":{"id":10143,"name":"Monad Testnet"},
#  "anchoring":"enabled","attestor":"configured"}
```

## Live deployment — Monad testnet (chainId 10143)

| Contract | Address |
|---|---|
| `TrustAgentPolicyRegistry` | [`0xb403392DDE0FdA621264FE3dCe1B7C3ad5bA412e`](https://testnet.monadexplorer.com/address/0xb403392DDE0FdA621264FE3dCe1B7C3ad5bA412e) |
| `ERC8004IdentityRegistry` | [`0x41db378FE661f9c6D31B031f42107C85eCad88b7`](https://testnet.monadexplorer.com/address/0x41db378FE661f9c6D31B031f42107C85eCad88b7) |
| `ChancelaApprovals` | [`0x4ed26528cC5518df075A4Ba463D56B478fAba42b`](https://testnet.monadexplorer.com/address/0x4ed26528cC5518df075A4Ba463D56B478fAba42b) — relying party `chancela.xyz` |

All three are **verified on Sourcify, exact match**, which means an independent
service recompiled the sources in this repository and got the bytecode that is
on chain — metadata hash included, so the compiler settings and even the
comments are the ones here. Check any of them without trusting this page:

```bash
curl -s https://sourcify.dev/server/v2/contract/10143/0x4ed26528cC5518df075A4Ba463D56B478fAba42b
# {"match":"exact_match","creationMatch":"exact_match", …}

# and to read the source the chain agrees with:
curl -s 'https://sourcify.dev/server/v2/contract/10143/0x4ed26528cC5518df075A4Ba463D56B478fAba42b?fields=sources'
```

`pnpm verify:deployment` checks this for all three, alongside the addresses.
Re-verify after a redeploy with:

```bash
cd packages/contracts
forge verify-contract <address> src/<Contract>.sol:<Contract> \
  --chain-id 10143 --verifier sourcify --verifier-url https://sourcify.dev/server
```

These are the second deployment. On 20 September 2026 the server's `.env` was
lost, and with it the deployer and attestation keys -- the only copies. Nobody
could call `setAttestor()` on the first registry again, so both contracts were
redeployed with new keys and the agents re-registered with the same policies.
The first registry,
[`0x649DD587…6d4b`](https://testnet.monadexplorer.com/address/0x649DD58756Ee9a4b65D8d9fd2D5Aa68097d36d4b),
still holds the 63 decisions anchored before that date; their proofs keep
linking to those transactions. The lesson is in the checklist above: back the
`.env` up somewhere that is not this server.

Registered agents, each with its policy anchored on-chain:

| Agent | Token | Policy | Policy hash |
|---|---|---|---|
| SalesAgent | #1 | v3 | `0xcd0ffd6d0603f5f53baa215150967ef56bd47e9926b6c06330dca8b579aaff04` |
| SupportAgent | #2 | v1 | `0xecd45276c57349a5711bfad4b64a61bed49a65191854b78232b0ed8fab9b174d` |
| TreasuryAgent | #3 | v2 | `0x317afe150f6333a338a397f784fdf5c88a36a5ccc7a9300f6df0cb31edac8733` |

Verify independently, without trusting this service:

```bash
cast call 0xb403392DDE0FdA621264FE3dCe1B7C3ad5bA412e \
  'activePolicy(uint256)(bytes32,uint32,uint64)' 1 \
  --rpc-url https://testnet-rpc.monad.xyz
# 0xcd0ffd6d…  3  1789926908
```

The returned hash is the same one `GET /api/agents/TA-001` serves. Recompute it
from the policy document with `hashPolicyDocument()` and all three agree.

### ERC-8004 on testnet

The canonical registries exist on mainnet only. Reading the code at the mainnet
addresses on testnet returns `0x` — verified, not assumed. So on testnet the
deploy script publishes `ERC8004IdentityRegistry`, a faithful minimal
implementation with the same ERC-721 shape, and `ownerOf()` means exactly what
it means on mainnet. On chain 143 the script binds to the canonical registry and
never deploys its own.

### RPC log-range limit

The public testnet RPC silently caps `eth_getLogs`: a 3000-block query returns
an empty result while a 30-block query over the same range returns the events.
Nothing errors, which makes it an easy trap. The indexer pages in small windows;
if you query logs by hand, keep the range narrow.
