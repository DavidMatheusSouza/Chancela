/**
 * A paper exchange, exposed to an AI agent over MCP, with Chancela inside the
 * tool rather than in the prompt.
 *
 * The agent gets one tool, `place_order`. It does not get a separate "ask for
 * permission" step it could forget or be talked out of: the tool itself calls
 * `guard()`, which asks the policy, verifies the signed answer against the
 * attestor the agent's owner registered on Monad, and only then fills the order.
 * Whatever the model decides, an order outside the owner's policy is not filled.
 *
 * Used by examples/trading-agent/claude-code-session.sh to let Claude Code act
 * as the trading agent TA-LIVE. Fills are simulated; decisions are real and
 * anchored on Monad.
 *
 *   pnpm tsx packages/mcp/examples/exchange-server.ts    (speaks MCP on stdio)
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { ChancelaError, attestorFromRegistry, createClient } from '../../sdk/src/index';

const API = process.env.CHANCELA_API_URL ?? 'https://chancela.xyz';
const AGENT = process.env.CHANCELA_AGENT_ID ?? 'TA-LIVE';
const TOKEN_ID = BigInt(process.env.CHANCELA_TOKEN_ID ?? '4');

const chancela = createClient({
  baseUrl: API,
  attestor: attestorFromRegistry({
    rpcUrl: process.env.MONAD_RPC_URL ?? 'https://testnet-rpc.monad.xyz',
    registry: (process.env.CHANCELA_REGISTRY ?? '0xb403392DDE0FdA621264FE3dCe1B7C3ad5bA412e') as `0x${string}`,
    tokenId: () => TOKEN_ID,
  }),
});

let fills = 0;
const server = new McpServer({ name: 'exchange', version: '0.1.0' });

server.tool(
  'place_order',
  'Place a market order on the exchange for this trading desk. Amount is the order notional in US dollars.',
  {
    market: z.string().describe('e.g. "MON/USDC"'),
    side: z.enum(['BUY', 'SELL']),
    amountUsd: z.number().positive().describe('Order notional in US dollars, e.g. 200'),
  },
  async ({ market, side, amountUsd }) => {
    // Exactly the parameters the fill will use, hashed into the permission.
    const order = { amount: Math.round(amountUsd * 100), market, side, orderType: 'MARKET' };
    try {
      const fill = await chancela.guard(AGENT, 'PLACE_ORDER', order, (decision) => ({
        status: 'FILLED',
        orderId: `PAPER-${++fills}`,
        market,
        side,
        notionalUsd: order.amount / 100,
        authorizedBy: `policy v${decision.policyVersion}, verified against the attestor registered on Monad`,
        proof: `${API}/proof/${decision.auditId}`,
      }));
      return { content: [{ type: 'text' as const, text: JSON.stringify(fill, null, 2) }] };
    } catch (err) {
      const e = err instanceof ChancelaError ? err : new ChancelaError('INTERNAL', String(err));
      return {
        isError: true,
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                status: 'REJECTED',
                code: e.code,
                reason: e.decision ? `${e.decision.reasonText} (${e.decision.reasonCode})` : e.message,
                proof: e.decision ? `${API}/proof/${e.decision.auditId}` : undefined,
                note: "Rejected by the owner's policy, not by the exchange. Rewording, splitting or retrying the order does not change the policy.",
              },
              null,
              2,
            ),
          },
        ],
      };
    }
  },
);

async function main() {
  await server.connect(new StdioServerTransport());
}
main();
