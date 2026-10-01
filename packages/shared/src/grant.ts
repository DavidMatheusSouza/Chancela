import { encodeAbiParameters, hashTypedData, keccak256, toHex } from 'viem';
import type { Hex } from './types';

/**
 * On-chain grants -- what ChancelaGate checks before a protocol executes.
 *
 * The capsule is canonical JSON, which a contract cannot afford to parse. For an
 * action a contract will carry out, the attestor also signs this compact EIP-712
 * grant. It names the decision (by the hash already anchored in the registry),
 * the contract allowed to spend it, and a hash of the exact call -- computed by
 * that contract from the arguments it receives. Mirrors
 * packages/contracts/src/ChancelaGate.sol; a test on each side pins the same
 * vector.
 */

export interface Grant {
  agentTokenId: bigint;
  target: Hex;
  callHash: Hex;
  decisionHash: Hex;
  policyHash: Hex;
  expiresAt: bigint;
}

export const GRANT_TYPES = {
  Grant: [
    { name: 'agentTokenId', type: 'uint256' },
    { name: 'target', type: 'address' },
    { name: 'callHash', type: 'bytes32' },
    { name: 'decisionHash', type: 'bytes32' },
    { name: 'policyHash', type: 'bytes32' },
    { name: 'expiresAt', type: 'uint64' },
  ],
} as const;

export function grantDomain(chainId: number, gate: Hex) {
  return { name: 'Chancela', version: '1', chainId, verifyingContract: gate } as const;
}

export function grantDigest(grant: Grant, chainId: number, gate: Hex): Hex {
  return hashTypedData({
    domain: grantDomain(chainId, gate),
    types: GRANT_TYPES,
    primaryType: 'Grant',
    message: grant,
  }) as Hex;
}

/** ChancelaDemoVenue.ORDER_TYPEHASH */
export const ORDER_TYPEHASH = keccak256(toHex('PLACE_ORDER(string market,string side,uint256 amount)'));

/**
 * The call hash a venue computes for PLACE_ORDER: market, side and the notional
 * in cents -- the fields the policy decided on. Optional order fields (type,
 * price, venue) stay bound by the capsule's intent hash, not by this one.
 */
export function orderCallHash(order: { market: string; side: string; amount: number | bigint }): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }],
      [ORDER_TYPEHASH, keccak256(toHex(order.market)), keccak256(toHex(order.side)), BigInt(order.amount)],
    ),
  ) as Hex;
}

/** ChancelaAccount.CALL_TYPEHASH */
export const CALL_TYPEHASH = keccak256(toHex('CALL(address target,uint256 value,bytes data)'));

/**
 * The call hash ChancelaAccount computes before it makes a call: the target,
 * the native value sent and the exact calldata. A grant signed over it cannot
 * be spent on a bigger amount, another contract or other arguments.
 */
export function accountCallHash(call: { target: Hex; value: bigint; data: Hex }): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'address' }, { type: 'uint256' }, { type: 'bytes32' }],
      [CALL_TYPEHASH, call.target, call.value, keccak256(call.data)],
    ),
  ) as Hex;
}

/** Revert reasons, in ChancelaGate.Reason order. */
export const GATE_REASONS = [
  'OK',
  'WRONG_TARGET',
  'CALL_MISMATCH',
  'EXPIRED',
  'ALREADY_USED',
  'AGENT_SUSPENDED',
  'POLICY_CHANGED',
  'NOT_THE_AGENT',
  'ATTESTOR_NOT_SET',
  'BAD_SIGNATURE',
] as const;
export type GateReason = (typeof GATE_REASONS)[number];
