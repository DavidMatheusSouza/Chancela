import {
  createPasskeyWithPrfOutput,
  createSecp256k1SigningSession,
  getEvmAddress,
  getPasskeyPrfOutput,
  type PasskeyCredentialMetadata,
  type Secp256k1SigningSession,
} from '@category-labs/mera';
import { toViemAccount } from '@category-labs/mera/viem';
import { HDKey } from '@scure/bip32';
import { entropyToMnemonic, mnemonicToSeedSync } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';

/**
 * One passkey, many keys.
 *
 * The owner holds a single passkey. Its PRF output is 32 bytes that never leave
 * the authenticator's control except as this derivation root, and everything
 * else is BIP-32 from there:
 *
 *   m/44'/60'/1'/0/0        the owner's own identity -- signs the login challenge
 *   m/44'/60'/0'/0/{index}  one key per agent, by its derivation index
 *
 * The owner sits on a separate account branch so that no agent index can ever
 * collide with it. Nothing here is stored: the seed lives in memory for as long
 * as the caller holds it, signing sessions are ended explicitly, and the only
 * thing persisted is the credential id, which mera documents as carrying no key
 * material. There is no seed phrase to back up because there is no seed at
 * rest -- the passkey *is* the backup, synced by the platform that holds it.
 *
 * Browser only: WebAuthn needs a user gesture and a secure context.
 */

export const OWNER_PATH = "m/44'/60'/1'/0/0";
export const agentPath = (index: number) => `m/44'/60'/0'/0/${index}`;

const STORAGE_KEY = 'chancela.passkey.credential';
const RP_NAME = 'Chancela';

export interface DerivedKey {
  path: string;
  address: `0x${string}`;
  session: Secp256k1SigningSession;
  account: ReturnType<typeof toViemAccount>;
}

export function rememberedCredential(): PasskeyCredentialMetadata | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PasskeyCredentialMetadata) : null;
  } catch {
    return null;
  }
}

function remember(credential: PasskeyCredentialMetadata) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(credential));
  } catch {
    /* private mode: the passkey still works, it just is not remembered */
  }
}

function toSeed(prfOutput: Uint8Array): Uint8Array {
  return mnemonicToSeedSync(entropyToMnemonic(prfOutput, wordlist));
}

/** Register a new passkey and return the seed it derives. One ceremony. */
export async function createPasskeySeed(): Promise<Uint8Array> {
  const created = await createPasskeyWithPrfOutput({
    rp: { id: location.hostname, name: RP_NAME },
    user: { name: `owner-${Date.now()}`, displayName: 'Chancela owner' },
  });
  remember({ credentialId: created.credentialId, transports: created.transports });
  return toSeed(created.prfOutput);
}

/** Unlock with a passkey that already exists on this device or account. */
export async function unlockPasskeySeed(): Promise<Uint8Array> {
  const credential = rememberedCredential() ?? undefined;
  const result = await getPasskeyPrfOutput({ rpId: location.hostname, credential });
  if (!credential) remember({ credentialId: result.credentialId });
  return toSeed(result.prfOutput);
}

export function deriveKey(seed: Uint8Array, path: string): DerivedKey {
  const node = HDKey.fromMasterSeed(seed).derive(path);
  if (!node.privateKey) throw new Error(`No private key at ${path}`);
  const session = createSecp256k1SigningSession({ privateKey: node.privateKey });
  return {
    path,
    address: getEvmAddress(session.publicKey) as `0x${string}`,
    session,
    account: toViemAccount(session),
  };
}

/** Zero the in-memory private keys. Signing afterwards throws SESSION_ENDED. */
export function endKeys(keys: DerivedKey[]) {
  for (const key of keys) {
    try {
      key.session.end();
    } catch {
      /* already ended */
    }
  }
}
