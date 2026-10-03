import type { IntentOrder } from "@metrix/shared";

/**
 * Chancela policy gate (optional, off by default).
 *
 * When CHANCELA_AGENT_ID is set, every non-sim order is first sent to Chancela
 * (https://github.com/DavidMatheusSouza/Chancela) as a PLACE_ORDER request. The
 * limits live in a policy the agent's owner anchors on Monad -- outside this
 * process, so neither the chat command `set_risk` nor a prompt injection can
 * loosen them. The order goes out only if the answer is ALLOW *and* its signed
 * capsule verifies against the attestor read from the registry contract for
 * exactly these parameters. Anything else (DENY, approval pending, unreachable,
 * bad signature) throws, and the agent loop records the order as rejected.
 *
 * R1–R6 still run first; this is a second, external gate, not a replacement.
 */
const env = process.env;

export const chancelaGate = {
  agentId: env.CHANCELA_AGENT_ID ?? "",
  /** ERC-8004 token id of the agent in Chancela's registry. */
  tokenId: BigInt(env.CHANCELA_TOKEN_ID ?? "0"),
  apiUrl: env.CHANCELA_API_URL ?? "https://chancela.xyz",
  rpcUrl: env.CHANCELA_RPC_URL ?? "https://testnet-rpc.monad.xyz",
  registry: (env.CHANCELA_REGISTRY ?? "0xb403392DDE0FdA621264FE3dCe1B7C3ad5bA412e") as `0x${string}`,
  /** USD value of one unit of the market's quote currency (1 for USDC quotes). */
  quoteUsd: Number(env.CHANCELA_QUOTE_USD ?? 1),
};

export function chancelaEnabled(): boolean {
  return chancelaGate.agentId !== "";
}

/** The PLACE_ORDER parameters for an intent. `amount` is the notional in cents. */
export function toPlaceOrder(intent: IntentOrder, quoteUsd = chancelaGate.quoteUsd) {
  const size = Number(intent.size);
  const price = Number(intent.price);
  if (!Number.isFinite(size) || size <= 0 || !Number.isFinite(price) || price <= 0) {
    throw new Error("Chancela: order has no usable size/price, cannot state its notional");
  }
  return {
    amount: Math.ceil(size * price * quoteUsd * 100),
    market: intent.market,
    side: intent.side === "buy" ? "BUY" : "SELL",
    orderType: intent.type === "limit" ? "LIMIT" : "MARKET",
    venue: intent.venue,
    clientOrderId: intent.clientOrderId,
  };
}

let client: Promise<import("chancela-sdk").ChancelaClient> | undefined;
function getClient() {
  client ??= import("chancela-sdk").then(({ createClient, attestorFromRegistry }) =>
    createClient({
      baseUrl: chancelaGate.apiUrl,
      attestor: attestorFromRegistry({
        rpcUrl: chancelaGate.rpcUrl,
        registry: chancelaGate.registry,
        tokenId: () => chancelaGate.tokenId,
      }),
    }),
  );
  return client;
}

/** Runs `send` only with a verified ALLOW for this exact order; throws otherwise. */
export async function withChancela<T>(intent: IntentOrder, send: () => Promise<T>): Promise<T> {
  if (!chancelaEnabled() || intent.venue === "sim") return send();
  const chancela = await getClient();
  try {
    return await chancela.guard(chancelaGate.agentId, "PLACE_ORDER", toPlaceOrder(intent), send);
  } catch (err) {
    const e = err as { name?: string; code?: string; message: string; decision?: { reasonCode?: string; auditId?: string } };
    if (e.name !== "ChancelaError") throw err;
    const audit = e.decision?.auditId ? ` ${chancelaGate.apiUrl}/proof/${e.decision.auditId}` : "";
    throw new Error(`Chancela ${e.code}${e.decision?.reasonCode ? ` [${e.decision.reasonCode}]` : ""}: order not sent.${audit}`);
  }
}
