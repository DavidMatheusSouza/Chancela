# Chancela in front of Metrix AI's orders

[Metrix AI](https://github.com/yigenfeng0707-netizen/metrix-ai) (Metropolis,
Track 01) is an autonomous trading agent on Kuru and Perpl with a chat interface.
Every order it sends goes through one function, `execute()` in
`apps/agent/src/execution/router.ts`.

**Status: offered to Metrix as [pull request #2](https://github.com/yigenfeng0707-netizen/metrix-ai/pull/2) on 5 Oct 2026. Metrix
has not reviewed, merged or agreed to it.** It is here so anyone can read it and run it.

## Why this agent

Metrix has six hard risk rules (R1–R6), and a chat command, `set_risk`, that lets
the model change those limits. Limits the model can rewrite are limits a prompt
injection can rewrite. The patch adds a second gate whose limits live in a policy
the owner anchors on Monad, outside the agent's process: nothing said in the chat
can move them.

## What the patch does

[`metrix-chancela-gate.patch`](metrix-chancela-gate.patch) — one new file, nine
lines changed in the router, three unit tests, two dependencies.

- **Off by default.** Without `CHANCELA_AGENT_ID` nothing changes. Sim mode is
  never touched.
- With it set, every Kuru or Perpl order is sent to Chancela as `PLACE_ORDER`
  (notional in cents, market, side, type, venue, Metrix's own `clientOrderId`).
- The order goes out only on an `ALLOW` whose signed capsule verifies, for
  exactly those parameters, against the attestor read from the registry contract.
- Anything else — `DENY`, approval pending, service unreachable, bad signature —
  throws. Metrix's loop already records a throwing order as `rejected`, so the
  refusal and its proof link land in Metrix's own audit trail.

## Run it

```bash
pnpm tsx --tsconfig examples/integrations/metrix/tsconfig.json examples/integrations/metrix/live-check.ts
```

[`chancela-gate.ts`](chancela-gate.ts) is the file from the patch, run here
against the public deployment with the order shape Metrix produces:

```
$200  order (20000 cents): SENT to the venue
$2,000 order: Chancela DENIED [LIMIT_EXCEEDED]: order not sent. https://chancela.xyz/proof/TA-AUDIT-3302072E
sim order: sim untouched
```

What has **not** been run: Metrix's own install, typecheck and test suite with
the patch applied, and a real Kuru order through it.

## Apply it

```bash
git clone https://github.com/yigenfeng0707-netizen/metrix-ai && cd metrix-ai
git apply /path/to/metrix-chancela-gate.patch
npm install && npm test -w @metrix/agent
```

Then in `apps/agent/.env`: `CHANCELA_AGENT_ID=TA-LIVE` and `CHANCELA_TOKEN_ID=4`
to try it against the public demo agent ($500 per order), or ask us for an agent
of your own ([how](../../trading-agent/README.md#5-your-own-agent-about-10-minutes-with-us)).

## Pull request text

**Title:** Optional on-chain policy gate for orders (Chancela) — off by default / 可选的链上策略闸门（默认关闭）

> Metrix already has R1–R6, but `set_risk` lets the model change those limits
> from the chat, so a prompt injection can loosen them before trading. This PR
> adds an optional second gate in `execute()`: when `CHANCELA_AGENT_ID` is set,
> each non-sim order must get a signed ALLOW from a policy the owner anchors on
> Monad, verified against the on-chain attestor for exactly that order. Refusals
> throw, so they are recorded as `rejected` with a public proof link. With the
> variable unset, behaviour is unchanged; sim mode is never touched.
>
> We are Chancela (Track 04) — different track, no competition. Happy to adjust
> anything.
>
> Metrix 已有 R1–R6 风控，但 `set_risk` 允许模型在聊天中修改限额，提示注入可以先放宽限额再下单。
> 本 PR 在 `execute()` 中加入一个可选的第二道闸门：设置 `CHANCELA_AGENT_ID` 后，每笔非 sim
> 订单必须先获得由所有者锚定在 Monad 上的策略签发的 ALLOW，并针对该订单的确切参数对照链上
> attestor 验证签名。被拒绝的订单会抛出异常，按现有逻辑记录为 `rejected`，并附公开的证明链接。
> 未设置该变量时行为完全不变；sim 模式不受影响。我们是 Chancela（Track 04），与 Metrix 不同赛道，
> 不存在竞争，欢迎提出任何修改意见。
