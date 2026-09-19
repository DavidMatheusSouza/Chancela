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

Postgres is namespaced (`trustagent-db`, volume `trustagent-pgdata`) and bound to
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

- **Give TrustAgent its own database, its own role and its own port.** Never
  reuse an existing cluster's credentials or database.
- Prefer full container isolation via `docker compose`, which the compose file
  already namespaces.
- Choose a free port explicitly: `WEB_PORT=3080 DB_PORT=5442 docker compose up -d`.

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
  - hostname: trustagent.example.com
    service: http://127.0.0.1:3080
  - service: http_status:404
```

```bash
cloudflared tunnel route dns <tunnel-id> trustagent.example.com
cloudflared tunnel run <tunnel-id>
```

TLS terminates at Cloudflare, so no certificate management and no inbound ports.

## Production checklist

- [ ] `ATTESTATION_PRIVATE_KEY` in a KMS/HSM, not an environment variable
- [ ] Attestation key funded with MON for anchoring
- [ ] `setAttestor()` called on-chain for every agent
- [ ] `setAgentWallet()` called, so the attestor/agent separation is enforced
- [ ] Every agent's policy anchored via `anchorPolicy()`
- [ ] `DATABASE_URL` set and `prisma migrate deploy` run
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
| `TrustAgentPolicyRegistry` | [`0x649DD58756Ee9a4b65D8d9fd2D5Aa68097d36d4b`](https://testnet.monadexplorer.com/address/0x649DD58756Ee9a4b65D8d9fd2D5Aa68097d36d4b) |
| `ERC8004IdentityRegistry` | [`0xA3Ee05B6A2956676964Bc1476617682660109824`](https://testnet.monadexplorer.com/address/0xA3Ee05B6A2956676964Bc1476617682660109824) |

Registered agents, each with its policy anchored on-chain:

| Agent | Token | Policy | Policy hash |
|---|---|---|---|
| SalesAgent | #1 | v3 | `0xcd0ffd6d0603f5f53baa215150967ef56bd47e9926b6c06330dca8b579aaff04` |
| SupportAgent | #2 | v1 | `0xecd45276c57349a5711bfad4b64a61bed49a65191854b78232b0ed8fab9b174d` |
| TreasuryAgent | #3 | v2 | `0x317afe150f6333a338a397f784fdf5c88a36a5ccc7a9300f6df0cb31edac8733` |

Verify independently, without trusting this service:

```bash
cast call 0x649DD58756Ee9a4b65D8d9fd2D5Aa68097d36d4b \
  'activePolicy(uint256)(bytes32,uint32,uint64)' 1 \
  --rpc-url https://testnet-rpc.monad.xyz
# 0xcd0ffd6d…  3  1789836300
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
