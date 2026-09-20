import { getAddress } from 'viem';

/**
 * The exact text a derived key signs to be bound as an agent's wallet.
 *
 * Shared by the browser, which signs it, and the server, which verifies it, so
 * the two cannot drift. It names both the address and the agent: a signature
 * lifted from one binding is useless for any other.
 */
export const bindMessage = (agentId: string, address: string) =>
  `Chancela: bind ${getAddress(address)} as the wallet of ${agentId}`;
