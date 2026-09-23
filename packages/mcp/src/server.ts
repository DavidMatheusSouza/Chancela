import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ChancelaError, attestorFromRegistry, createClient, type ChancelaClient } from '../../sdk/src/index';

/**
 * Chancela over the Model Context Protocol.
 *
 * An agent that can call tools can call this one first. `chancela_authorize`
 * asks the policy engine whether the agent may do something, and -- when a
 * registry is configured -- checks the signed answer locally against the
 * attestor the agent's owner registered on Monad, so the agent's runtime is not
 * taking a web server's word for it.
 *
 * The tool descriptions are written for the model that will read them: they say
 * when to call, and what not to do after a refusal. A gate the agent may argue
 * with, rephrase around or retry is not a gate.
 */

export interface ServerOptions {
  /** A Chancela deployment. */
  apiUrl: string;
  /** Agent the tools act for when a call does not name one. */
  defaultAgentId?: string;
  /** Policy registry on Monad. With `rpcUrl`, enables local verification. */
  registry?: `0x${string}`;
  rpcUrl?: string;
  fetch?: typeof fetch;
  /** Test seam: supply the client instead of building one. */
  client?: ChancelaClient;
}

const REFUSAL_RULES =
  'If the answer is not ALLOW, do not perform the action, do not rephrase the request, do not split it into smaller ones and do not retry: the policy decides, not the wording. Tell the user what was refused and why.';

export function createServer(options: ServerOptions): McpServer {
  const verifying = Boolean(options.registry && options.rpcUrl);
  const tokenIds = new Map<string, bigint>();

  const client =
    options.client ??
    createClient({
      baseUrl: options.apiUrl,
      fetch: options.fetch,
      attestor: verifying
        ? attestorFromRegistry({
            rpcUrl: options.rpcUrl!,
            registry: options.registry!,
            tokenId: async (agentId) => {
              const known = tokenIds.get(agentId);
              if (known !== undefined) return known;
              const passport = (await client.passport(agentId)) as { agent?: { erc8004TokenId?: string } };
              const id = passport.agent?.erc8004TokenId;
              if (!id) throw new ChancelaError('NOT_REGISTERED', `${agentId} has no on-chain identity to verify against.`);
              tokenIds.set(agentId, BigInt(id));
              return BigInt(id);
            },
          })
        : undefined,
    });

  const agentOf = (given?: string) => {
    const id = given ?? options.defaultAgentId;
    if (!id) throw new ChancelaError('NO_AGENT', 'Pass agentId, or start the server with CHANCELA_AGENT_ID.');
    return id;
  };

  const text = (value: unknown, isError = false) => ({
    content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
    isError,
  });

  const failure = (err: unknown) =>
    text(
      err instanceof ChancelaError
        ? { authorized: false, error: err.code, message: err.message, rule: REFUSAL_RULES }
        : { authorized: false, error: 'INTERNAL', message: String(err), rule: REFUSAL_RULES },
      true,
    );

  const server = new McpServer({ name: 'chancela', version: '0.1.0' });

  server.tool(
    'chancela_authorize',
    `Ask Chancela whether this agent may perform an action, BEFORE performing it. Call this before any tool that moves funds, sends a message as the user or company, or creates, changes or deletes records. Pass the exact parameters you are about to use. ${REFUSAL_RULES} No answer, an error or an unverified answer all mean no.`,
    {
      action: z.string().describe('Action name from the tool registry, e.g. TRANSFER_FUNDS, PLACE_ORDER, CREATE_CUSTOMER, SEND_MESSAGE.'),
      parameters: z.record(z.unknown()).default({}).describe('The exact parameters the action will be performed with.'),
      agentId: z.string().optional().describe('Chancela agent id, e.g. TA-001. Defaults to the configured agent.'),
    },
    async ({ action, parameters, agentId }) => {
      try {
        const id = agentOf(agentId);
        const decision = await client.authorize(id, action, parameters);
        let verified: boolean | null = null;
        let verification: string | undefined;
        if (decision.decision === 'ALLOW' && verifying) {
          const verdict = await client.verify(decision, { agentId: id, action, parameters });
          verified = verdict.ok;
          verification = verdict.code;
        }
        const authorized = decision.decision === 'ALLOW' && verified !== false;
        return text(
          {
            authorized,
            decision: decision.decision,
            reason: `${decision.reasonText} (${decision.reasonCode})`,
            risk: decision.risk,
            verified: verifying ? verified : 'not checked: no registry configured',
            ...(verification && verification !== 'OK' ? { verification } : {}),
            auditId: decision.auditId,
            policyVersion: decision.policyVersion,
            proof: `${options.apiUrl.replace(/\/+$/, '')}/api/proofs/${decision.auditId}`,
            ...(authorized ? {} : { rule: REFUSAL_RULES }),
          },
          !authorized,
        );
      } catch (err) {
        return failure(err);
      }
    },
  );

  server.tool(
    'chancela_passport',
    'Read an agent\'s passport: its on-chain identity, status, the permissions its active policy grants, and its trust score. Use it to find out what the agent may do before planning a task.',
    { agentId: z.string().optional().describe('Defaults to the configured agent.') },
    async ({ agentId }) => {
      try {
        const p = (await client.passport(agentOf(agentId))) as {
          agent: { id: string; name: string; status: string; erc8004TokenId?: string; walletAddress?: string };
          policy: { version: number; policyHash: string; document: { permissions: string[] } } | null;
          trustScore?: { score: number };
          wallet?: { inRegistry: boolean | null } | null;
        };
        return text({
          id: p.agent.id,
          name: p.agent.name,
          status: p.agent.status,
          identity: p.agent.erc8004TokenId ? `ERC-8004 #${p.agent.erc8004TokenId}` : 'unregistered',
          wallet: p.agent.walletAddress ?? null,
          walletInRegistry: p.wallet?.inRegistry ?? null,
          policyVersion: p.policy?.version ?? null,
          policyHash: p.policy?.policyHash ?? null,
          permissions: p.policy?.document.permissions ?? [],
          trustScore: p.trustScore?.score ?? null,
        });
      } catch (err) {
        return failure(err);
      }
    },
  );

  server.tool(
    'chancela_proof',
    'Fetch the public proof of one decision by its audit id: the hashes, whether they verify, and the Monad transaction that anchors it. Use it to show a user or counterparty that a decision really happened.',
    { auditId: z.string().describe('e.g. TA-AUDIT-188905E7, as returned by chancela_authorize.') },
    async ({ auditId }) => {
      try {
        return text(await client.proof(auditId));
      } catch (err) {
        return failure(err);
      }
    },
  );

  return server;
}
