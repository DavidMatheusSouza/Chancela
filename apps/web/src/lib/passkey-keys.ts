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

/**
 * Tell the browser where a passkey belongs: on this device or in the account's
 * password manager first, a phone over QR second, a USB security key last.
 *
 * mera sends no preference, and on a Windows machine without Windows Hello that
 * leaves the operating system to pick -- and it picks "insert your security
 * key", which reads as a dead end to anyone who does not own one. `hints` is
 * the WebAuthn Level 3 way to say otherwise; browsers that do not know it
 * ignore it. mera builds the request itself, so the hint is added on the way
 * through and the original `create` is put back whatever happens.
 */
async function preferringBuiltInPasskeys<T>(ceremony: () => Promise<T>): Promise<T> {
  const container = navigator.credentials;
  const original = container.create;
  container.create = function (options?: CredentialCreationOptions) {
    const publicKey = options?.publicKey
      ? { ...options.publicKey, hints: ['client-device', 'hybrid', 'security-key'] }
      : undefined;
    return original.call(container, publicKey ? { ...options, publicKey } : options);
  };
  try {
    return await ceremony();
  } finally {
    container.create = original;
  }
}

/** Register a new passkey and return the seed it derives. One ceremony. */
export async function createPasskeySeed(): Promise<Uint8Array> {
  const created = await preferringBuiltInPasskeys(() =>
    createPasskeyWithPrfOutput({
      rp: { id: location.hostname, name: RP_NAME },
      user: { name: `owner-${Date.now()}`, displayName: 'Chancela owner' },
    }),
  );
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

/**
 * Say what went wrong with a passkey in terms someone can act on.
 *
 * The two failures people actually meet are not bugs: an authenticator without
 * PRF, and a computer with nowhere to keep a passkey -- which shows up as the
 * operating system asking for a USB key, then as a cancelled ceremony.
 */
export function passkeyErrorText(err: unknown, fallback: string): string {
  const text = err instanceof Error ? err.message : '';
  if (/prf/i.test(text)) {
    return 'This authenticator does not support the PRF extension that key derivation needs. Use a built-in passkey: Android, iPhone (iOS 18+), Touch ID, an up-to-date Windows 11 with Windows Hello, or Chrome signed in to a Google account.';
  }
  if (/passkey (creation|operation)|cancel|not allowed|abort|timed out/i.test(text)) {
    return 'No passkey was created. If your computer asked for a USB security key, it has nowhere built-in to keep a passkey: set up a Windows Hello PIN (Settings → Accounts → Sign-in options), or sign in to Chrome with a Google account, or open this page on your phone.';
  }
  return text || fallback;
}
