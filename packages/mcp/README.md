# chancela-mcp

[Chancela](https://chancela.xyz) over the Model Context Protocol: any agent that
can call tools can ask, before it acts, whether it may — and get an answer it can
verify instead of trust.

```json
{
  "mcpServers": {
    "chancela": {
      "command": "npx",
      "args": ["-y", "chancela-mcp"],
      "env": {
        "CHANCELA_API_URL": "https://chancela.xyz",
        "CHANCELA_AGENT_ID": "TA-001",
        "CHANCELA_REGISTRY": "0xb403392DDE0FdA621264FE3dCe1B7C3ad5bA412e"
      }
    }
  }
}
```

That is the whole integration for Claude Desktop, Claude Code, Cursor or any
other MCP client.

| Tool | |
|---|---|
| `chancela_authorize` | Ask whether the agent may perform an action, with the exact parameters it is about to use. Returns `authorized`, the decision, the reason, the audit id and a link to the public proof. |
| `chancela_passport` | The agent's on-chain identity, status, granted permissions and trust score — what it may do, before it plans. |
| `chancela_proof` | The public proof of one decision, including the Monad transaction that anchors it. |

With `CHANCELA_REGISTRY` set, an `ALLOW` is only reported as `authorized` after
the signed permission verifies locally: signed by the attestor the agent's owner
registered on Monad, bound to those exact parameters, not expired. A deployment
can refuse to answer; it cannot forge a yes. Without a registry the result says
`verified: "not checked"` rather than implying it was.

The tool description is written for the model reading it. It says to call
before acting, and what not to do after a refusal: not rephrase, not split the
request, not retry. An unreachable deployment, an error and an unverified answer
are all refusals.

| Variable | Default |
|---|---|
| `CHANCELA_API_URL` | `https://chancela.xyz` |
| `CHANCELA_AGENT_ID` | none — pass `agentId` on each call |
| `CHANCELA_REGISTRY` | none — verification off |
| `CHANCELA_RPC_URL` | `https://testnet-rpc.monad.xyz` |

MIT · [source](https://github.com/DavidMatheusSouza/Chancela/tree/main/packages/mcp)
