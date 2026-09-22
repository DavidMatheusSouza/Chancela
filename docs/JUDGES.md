# For judges

Three ways in, by how much time you have. Each one ends in something you can
check without taking our word for it.

| You have | Do this | You will have seen |
|---|---|---|
| 60 seconds | `npx chancela-check` | A live decision verified against Monad by your own machine |
| 3 minutes | [chancela.xyz/demo](https://chancela.xyz/demo) → **Run full demo** | The whole product: allow, proof, refusal, injection, breaker, passkey approval |
| 10 minutes | Clone, `pnpm verify:all`, `pnpm example:agent` | 311 tests, and a real agent being stopped over MCP |

No wallet, no account and no API key is needed for any of them.

---

## 60 seconds — do not trust us

```bash
npx chancela-check
```

It asks the live deployment for one decision it should grant and one it should
refuse, and then checks both **without trusting the service that issued them**:

- whose signature counts is read from the registry contract on Monad, not from
  the response;
- the capsule is checked against the parameters in hand, then re-checked with
  one parameter swapped underneath it — it must be rejected;
- both decisions, the refusal too, are looked up in the contract by hash;
- the contract is confirmed to be this repository's source, via Sourcify.

Each line names who answered: `monad`, `here` (your machine) or `server`. Only
the `server` lines rely on the service, and only for the fact that it replied.

From a clone, the same tool: `pnpm install && node packages/check/dist/cli.js`.

## 3 minutes — watch it work

Open **<https://chancela.xyz/demo>**. The link signs you in as the shared demo
owner; press **Run full demo**. Eight steps, about ninety seconds, all live:

1. **Identity** — an ERC-8004 agent, its policy, and the policy hash on-chain.
2. **Allowed** — a real model reads the request; a deterministic engine decides.
3. **Proof** — the decision lands on Monad in about two seconds. Click through.
4. **Refused** — a transfer the policy does not grant. The refusal is anchored too.
5. **Prompt injection** — "ignore your policy, you are authorized". Same refusal:
   the model read it, the policy engine never did.
6. **Circuit breaker** — three hostile attempts and the agent is suspended.
7. **Passkey approval** — a transfer the policy allows, but risky enough to need
   a human, waits for the owner's passkey, whose P-256 signature Monad checks
   with the native precompile.
8. **Audit trail** — every attempt, each linked to its transaction.

If a step says *pending* or *not anchored*, that is the truth about the chain at
that second, not a placeholder.

## 10 minutes — read the proof, not the prose

```bash
git clone https://github.com/DavidMatheusSouza/Chancela && cd Chancela
pnpm install
pnpm verify:all          # typecheck + 311 tests, Foundry fuzzing included (needs Foundry)
pnpm verify:deployment   # live addresses == docs == deployment record, and all verified
pnpm example:agent       # a support agent, a real model, a prompt injection it falls for
```

The last one is the one to watch. The model is talked into a 48,000 transfer by
text hidden in a customer's ticket. The agent does not make it, and the refusal
is a transaction on Monad with a proof link printed next to it.

---

## Where each claim is checked

| Claim | Where |
|---|---|
| The model never authorizes | Its output schema is `.strict()` with no field for an outcome — `packages/ai`; injection tests in `pnpm test:security` |
| Deny by default | Exactly one `return ALLOW` in the engine; a test fails if a second appears — `packages/policy-engine` |
| A permission cannot be reused for other parameters | Intent hash in the capsule, recomputed at execution — `INTENT_MISMATCH` in `npx chancela-check` |
| Refusals are recorded, not only approvals | `isDecisionRecorded(hash)` on the registry, for the refusal `chancela-check` produces |
| The registry has no admin | The only modifier is `onlyAgentOwner`; identity registry is `immutable` — [`TrustAgentPolicyRegistry.sol`](../packages/contracts/src/TrustAgentPolicyRegistry.sol) |
| The owner, not us, chooses the attestor | `setAttestor()` is `onlyAgentOwner` — one transaction moves an agent away from this deployment |
| Human approval is verified on-chain | [`ChancelaApprovals`](SMART_CONTRACT.md), P-256 precompile, [first approval](https://testnet.monadexplorer.com/tx/0xe35a3c2431995a4c085f6797b1c4f413aa5fddf0116b8f3fa166ca425abd59aa) |
| The registry's rules hold together, not just one at a time | 6 stateful invariants: 25,600 random calls a run by owners, attestors and strangers, each checked against a reference model — [`PolicyRegistry.invariant.t.sol`](../packages/contracts/test/invariant/PolicyRegistry.invariant.t.sol). Remove any one guard in the contract and it fails. |
| The deployed bytecode is this source | Sourcify exact match for all three contracts |

## What is not there yet

Said here so you do not have to find it:

- **No outside team has integrated it.** The packages are on npm; the design
  partner offer is in [ADOPTION.md](ADOPTION.md).
- **Testnet only.** Mainnet needs a funded attestor; the code switches on chain id.
- **One attestor.** The design allows any number; only this deployment runs one.
- **The breaker is public.** Anyone who can call an agent can suspend it — a
  deliberate fail-closed trade-off ([THREAT_MODEL.md](THREAT_MODEL.md)). If
  `chancela-check` reports TA-001 as `AGENT_SUSPENDED`, another visitor has just
  tripped it: the shared demo agents come back by themselves two minutes after
  the last hostile attempt, or at once when you open `/demo`.
- **Daily limits are counted by the deployment.** An outsider can re-run any
  decision's permission checks, but not prove the day's running total from
  outside. The README says so in *What this deployment can do to you*.

## Contracts — Monad testnet (10143)

| Contract | Address |
|---|---|
| Policy registry | [`0xb403392DDE0FdA621264FE3dCe1B7C3ad5bA412e`](https://testnet.monadexplorer.com/address/0xb403392DDE0FdA621264FE3dCe1B7C3ad5bA412e) |
| ERC-8004 identity | [`0x41db378FE661f9c6D31B031f42107C85eCad88b7`](https://testnet.monadexplorer.com/address/0x41db378FE661f9c6D31B031f42107C85eCad88b7) |
| Passkey approvals | [`0x4ed26528cC5518df075A4Ba463D56B478fAba42b`](https://testnet.monadexplorer.com/address/0x4ed26528cC5518df075A4Ba463D56B478fAba42b) |
