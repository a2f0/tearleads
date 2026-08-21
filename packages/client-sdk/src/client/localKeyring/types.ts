export const LOCAL_KEYRING_MANIFEST_FORMAT = "symcrypt.local-keyring.manifest";
export const WRAPPED_LOCAL_SECRET_FORMAT = "symcrypt.wrapped-local-secret";

export type LocalKeyringManifestFormat = typeof LOCAL_KEYRING_MANIFEST_FORMAT;
export type WrappedLocalSecretFormat = typeof WRAPPED_LOCAL_SECRET_FORMAT;

export type LocalKeyPurpose =
  | "account-root"
  | "sqlite"
  | "blob-store"
  | "identity-persistence"
  | (string & {});

export interface LocalKeyringScope {
  readonly accountId?: string | null | undefined;
  readonly namespace: string;
  readonly signingFingerprint?: string | null | undefined;
}

export interface NormalizedLocalKeyringScope {
  readonly accountId: string | null;
  readonly namespace: string;
  readonly signingFingerprint: string | null;
}

export interface LocalSecretContext {
  readonly purpose: LocalKeyPurpose;
  readonly scope: NormalizedLocalKeyringScope;
}

export interface WrappingKeyHandle {
  readonly keyId: string;
  readonly provider: string;
}

export interface WrappedLocalSecretEnvelope {
  readonly algorithm: string;
  readonly ciphertext: string;
  readonly context: LocalSecretContext;
  readonly format: WrappedLocalSecretFormat;
  readonly iv?: string | undefined;
  readonly keyId: string;
  readonly provider: string;
  readonly version: 1;
  readonly wrappedAt: string;
}

export interface WrapLocalSecretInput {
  readonly context: LocalSecretContext;
  readonly handle: WrappingKeyHandle;
  readonly plaintext: Uint8Array;
}

export interface UnwrapLocalSecretInput {
  readonly context: LocalSecretContext;
  readonly envelope: WrappedLocalSecretEnvelope;
}

export interface WrappingKeyKeystore {
  readonly provider: string;
  close?(): void;
  deleteWrappingKey(scope: LocalKeyringScope): Promise<void>;
  getOrCreateWrappingKey(scope: LocalKeyringScope): Promise<WrappingKeyHandle>;
  unwrapSecret(input: UnwrapLocalSecretInput): Promise<Uint8Array<ArrayBuffer>>;
  wrapSecret(input: WrapLocalSecretInput): Promise<WrappedLocalSecretEnvelope>;
}

export interface LocalKeyringManifest {
  readonly createdAt: string;
  readonly format: LocalKeyringManifestFormat;
  readonly rootKeyEnvelope: WrappedLocalSecretEnvelope;
  readonly scope: NormalizedLocalKeyringScope;
  readonly updatedAt: string;
  readonly version: 1;
}

export interface LocalKeyringManifestStore {
  close?(): void;
  deleteManifest(scope: LocalKeyringScope): Promise<void>;
  loadManifest(scope: LocalKeyringScope): Promise<LocalKeyringManifest | null>;
  saveManifest(manifest: LocalKeyringManifest): Promise<void>;
}

export interface LocalKeyringSession {
  readonly blobStoreKey: Uint8Array<ArrayBuffer>;
  readonly identityPersistenceKey: Uint8Array<ArrayBuffer>;
  readonly manifest: LocalKeyringManifest;
  readonly scope: NormalizedLocalKeyringScope;
  readonly sqliteKey: string;
  deriveKey(purpose: LocalKeyPurpose): Promise<Uint8Array<ArrayBuffer>>;
  dispose(): void;
}

export interface LocalKeyring {
  /**
   * Releases resources owned by the keyring service. Sessions already returned
   * to callers remain valid until their holder calls `dispose()`.
   */
  close?(): void;
  deleteSession(scope: LocalKeyringScope): Promise<void>;
  getOrCreateSession(scope: LocalKeyringScope): Promise<LocalKeyringSession>;
  loadSession(scope: LocalKeyringScope): Promise<LocalKeyringSession | null>;
}

export interface LocalKeyringOptions {
  readonly keystore: WrappingKeyKeystore;
  readonly manifestStore: LocalKeyringManifestStore;
  readonly now?: (() => Date) | undefined;
}

export type LocalKeyringManifestStorage = Pick<
  Storage,
  "getItem" | "removeItem" | "setItem"
>;

/**
 * How the AES-GCM wrapping key is stored in IndexedDB.
 *
 * - `"crypto-key"` (default): persist the live, non-extractable {@link CryptoKey}
 *   object via structured clone. The key material can never be read back out of
 *   IndexedDB, only used — the strongest option, and what browsers support.
 * - `"raw-bytes"`: persist the exported raw key bytes and re-import them on read.
 *   The key is therefore extractable and readable by anything with IndexedDB
 *   access, so this is strictly weaker. It exists for WKWebView-based shells
 *   (Electrobun/Capacitor) where structured-cloning a CryptoKey requires writing
 *   a "WebCrypto master key" to the macOS keychain — which fails with
 *   `errSecInteractionNotAllowed` (-25308) in an unsigned app and throws
 *   `DataCloneError`, taking down keyring init (and, on some WebKit builds,
 *   crashing the WebContent process).
 */
export type WrappingKeyMaterialStorage = "crypto-key" | "raw-bytes";
