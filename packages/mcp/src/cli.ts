#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server';

const apiUrl = process.env.CHANCELA_API_URL ?? 'https://chancela.xyz';
const registry = process.env.CHANCELA_REGISTRY as `0x${string}` | undefined;

const server = createServer({
  apiUrl,
  defaultAgentId: process.env.CHANCELA_AGENT_ID,
  registry,
  rpcUrl: process.env.CHANCELA_RPC_URL ?? (registry ? 'https://testnet-rpc.monad.xyz' : undefined),
});

await server.connect(new StdioServerTransport());
// stdout belongs to the protocol; anything for a human goes to stderr.
console.error(`chancela-mcp: ${apiUrl}${registry ? `, verifying against ${registry}` : ', not verifying (set CHANCELA_REGISTRY)'}`);
