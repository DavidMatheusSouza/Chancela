# Chancela indexer (Envio HyperIndex)

Turns `TrustAgentPolicyRegistry` events on Monad into a GraphQL API that powers
the Trust Activity Explorer.

## Why this exists

Without an indexer, the "audit trail" is a `SELECT` against the same service
that produced the decisions -- which proves nothing. With it, the explorer reads
the chain independently. That separation is the entire point.

## Setup

1. Deploy the registry and put its address in `config.yaml`.
2. Set the network id: `10143` for Monad testnet, `143` for mainnet.
3. Run:

```bash
pnpm codegen
pnpm dev
```

4. Point the app at the resulting endpoint:

```bash
ENVIO_GRAPHQL_URL=http://localhost:8080/v1/graphql
```

## Example query

```graphql
query AgentActivity($agentTokenId: numeric!) {
  Decision(
    where: { agentTokenId: { _eq: $agentTokenId } }
    order_by: { ts: desc }
    limit: 100
  ) {
    decisionHash
    action
    decision
    risk
    policyHash
    ts
    txHash
  }
}
```
