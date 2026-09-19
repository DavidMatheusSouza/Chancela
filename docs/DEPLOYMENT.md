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
