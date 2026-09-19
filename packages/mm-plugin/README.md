# @trustagent/mm-plugin

TrustAgent policy checks for [MetaMask Agent Wallet](https://docs.metamask.io/agent-wallet/).

Agent Wallet simulates transactions, scans them with Blockaid and enforces
outflow limits. It cannot answer the question that comes first: **is this agent
permitted to attempt this at all**, under a named policy, with a record anyone
can verify afterwards?

This plugin adds that step.

## Install

```bash
mm plugin install @trustagent/mm-plugin
mm config set trustagent.apiUrl https://your-trustagent-deployment
```

## Commands

```bash
mm trustagent passport TA-001
mm trustagent authorize TA-001 TRANSFER_FUNDS '{"amount":500000,"recipient":"Joao"}'
mm trustagent audit TA-001 --limit 20
```

`authorize` exits non-zero on `DENY` and on `REQUIRE_APPROVAL`, so Agent Wallet
aborts the pending operation rather than merely printing a warning.

```
$ mm trustagent authorize TA-001 TRANSFER_FUNDS '{"amount":500000,"recipient":"Joao"}'
✕ DENY  TRANSFER_FUNDS  [CRITICAL]
  reason      Agent does not have permission to perform this action. (PERMISSION_DENIED)
  policy      v3  0xcd0ffd6d...
  audit       TA-AUDIT-051F1C9A
  proof       0x051f1c9a... (confirmed)
$ echo $?
1
```

Every command calls the same `POST /api/agents/:id/authorize` endpoint the
dashboard uses. There is no plugin-specific path, which is why the answer here
and the answer in the UI cannot disagree.
