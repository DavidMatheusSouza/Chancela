# chancela-sdk

Ask [Chancela](https://chancela.xyz) whether an AI agent may act — and check the
answer yourself instead of trusting the server that gave it.

```bash
npm install chancela-sdk viem
```

```ts
import { attestorFromRegistry, createClient } from 'chancela-sdk';

const chancela = createClient({
  baseUrl: 'https://chancela.xyz',
  // Whose signature counts is read from Monad, not from the server being checked.
  attestor: attestorFromRegistry({
    rpcUrl: 'https://testnet-rpc.monad.xyz',
    registry: '0xb403392DDE0FdA621264FE3dCe1B7C3ad5bA412e',
    tokenId: (agentId) => tokenIds[agentId],
  }),
});

await chancela.guard('TA-003', 'TRANSFER_FUNDS', { amount, recipientAddress }, () =>
  wallet.sendTransaction({ to: recipientAddress, value: amount }),
);
```

`guard` runs your function only if the policy allows the action **and** the
signed permission verifies locally: signed by the attestor the agent's owner
registered on-chain, bound to the exact parameters you are about to use, and
not expired. It throws a `ChancelaError` — and never calls your function — on a
refusal, a step-up, an unreachable deployment, a malformed answer, a signature
from the wrong key, or parameters that differ from the ones authorized.

No answer is never permission.

| | |
|---|---|
| `authorize(agentId, action, parameters)` | Ask. Returns the decision whatever it is; a `DENY` is an answer, not an error. |
| `verify(decision, { agentId, action, parameters })` | Check a decision locally. Returns `{ ok, code }`. |
| `guard(agentId, action, parameters, act)` | Authorize, verify, then run `act`. |
| `proof(auditId)` | The public proof of a decision, including its Monad transaction. |
| `passport(agentId)` | Identity, active policy and trust score. |
| `attestorFromRegistry({ rpcUrl, registry, tokenId })` | Resolve the attestor from the on-chain policy registry. |

A deployment can refuse to answer. It cannot forge a yes.

MIT · [source](https://github.com/DavidMatheusSouza/Chancela/tree/main/packages/sdk)
