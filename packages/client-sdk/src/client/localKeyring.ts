import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import { IndexedDbStoreConnection } from "./indexedDbStoreConnection";

export const LOCAL_KEYRING_MANIFEST_FORMAT = "tearleads.local-keyring.manifest";
export const WRAPPED_LOCAL_SECRET_FORMAT = "tearleads.wrapped-local-secret";

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

export interface LocalStorageLocalKeyringManifestStoreOptions {
  readonly prefix?: string | undefined;
  readonly storage?: LocalKeyringManifestStorage | undefined;
}

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

export interface IndexedDbWrappingKeyKeystoreOptions {
  readonly databaseName?: string | undefined;
  readonly indexedDB?: IDBFactory | undefined;
  readonly keyMaterialStorage?: WrappingKeyMaterialStorage | undefined;
  readonly objectStoreName?: string | undefined;
  readonly provider?: string | undefined;
}

export interface BrowserLocalKeyringOptions {
  readonly databaseName?: string | undefined;
  readonly indexedDB?: IDBFactory | undefined;
  readonly keyMaterialStorage?: WrappingKeyMaterialStorage | undefined;
  /** Explicit manifest store; overrides the default IndexedDB/localStorage selection. */
  readonly manifestStore?: LocalKeyringManifestStore | undefined;
  /** localStorage-backed manifest storage (forces the localStorage store). */
  readonly manifestStorage?: LocalKeyringManifestStorage | undefined;
  readonly manifestStoragePrefix?: string | undefined;
  readonly objectStoreName?: string | undefined;
  readonly provider?: string | undefined;
  readonly now?: (() => Date) | undefined;
}

const TEXT_ENCODER = new TextEncoder();
const LOCAL_ROOT_KEY_BYTES = 32;
const WRAPPING_KEY_BYTES = 32;
const DEFAULT_WRAPPING_KEY_MATERIAL_STORAGE: WrappingKeyMaterialStorage =
  "crypto-key";
const AES_GCM_IV_BYTES = 12;
const AES_GCM_WRAPPING_ALGORITHM = "aes-256-gcm";
const BROWSER_INDEXED_DB_PROVIDER = "browser-indexeddb";
const BROWSER_KEYRING_DATABASE_NAME = "tearleads-local-keyring";
const BROWSER_WRAPPING_KEYS_STORE_NAME = "wrappingKeys";
const LOCAL_STORAGE_MANIFEST_PREFIX = "tearleads.local-keyring.manifest:";

export function copyBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

function randomBytes(byteLength: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(byteLength));
}

export function assertNonEmptyString(value: string, label: string): void {
  if (value.length === 0) {
    throw new Error(`${label} must be non-empty.`);
  }
}

function normalizeOptionalString(
  value: string | null | undefined,
  label: string,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  assertNonEmptyString(value, label);
  return value;
}

export function normalizeLocalKeyringScope(
  scope: LocalKeyringScope,
): NormalizedLocalKeyringScope {
  assertNonEmptyString(scope.namespace, "Local keyring namespace");

  return {
    accountId: normalizeOptionalString(
      scope.accountId,
      "Local keyring account id",
    ),
    namespace: scope.namespace,
    signingFingerprint: normalizeOptionalString(
      scope.signingFingerprint,
      "Local keyring signing fingerprint",
    ),
  };
}

export function localKeyringScopeKey(scope: LocalKeyringScope): string {
  const normalizedScope = normalizeLocalKeyringScope(scope);
  return JSON.stringify([
    normalizedScope.namespace,
    normalizedScope.accountId,
    normalizedScope.signingFingerprint,
  ]);
}

export function localSecretContext(
  scope: NormalizedLocalKeyringScope,
  purpose: LocalKeyPurpose,
): LocalSecretContext {
  assertNonEmptyString(purpose, "Local key purpose");
  return { purpose, scope };
}

export function canonicalLocalSecretContext(
  context: LocalSecretContext,
): string {
  return JSON.stringify({
    purpose: context.purpose,
    scope: normalizeLocalKeyringScope(context.scope),
  });
}

function localSecretAdditionalData(
  context: LocalSecretContext,
): Uint8Array<ArrayBuffer> {
  return copyBytes(TEXT_ENCODER.encode(canonicalLocalSecretContext(context)));
}

function localKeyringSalt(
  scope: NormalizedLocalKeyringScope,
): Uint8Array<ArrayBuffer> {
  return copyBytes(
    TEXT_ENCODER.encode(
      `tearleads.local-keyring.v1.${localKeyringScopeKey(scope)}`,
    ),
  );
}

async function hashHex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", copyBytes(bytes)),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

async function localWrappingKeyScopeHash(
  scope: NormalizedLocalKeyringScope,
): Promise<string> {
  const keyMaterial = TEXT_ENCODER.encode(
    `tearleads.local-wrapping-key.v1.${localKeyringScopeKey(scope)}`,
  );
  return hashHex(keyMaterial);
}

async function memoryWrappingKeyId(
  scope: NormalizedLocalKeyringScope,
): Promise<string> {
  return `memory:${await localWrappingKeyScopeHash(scope)}`;
}

async function importHkdfRootKey(rootKey: Uint8Array): Promise<CryptoKey> {
  if (rootKey.byteLength !== LOCAL_ROOT_KEY_BYTES) {
    throw new Error("Local keyring root key must be 32 bytes.");
  }

  return crypto.subtle.importKey("raw", copyBytes(rootKey), "HKDF", false, [
    "deriveBits",
  ]);
}

async function deriveLocalSecretKey(input: {
  readonly purpose: LocalKeyPurpose;
  readonly rootKey: Uint8Array;
  readonly scope: NormalizedLocalKeyringScope;
}): Promise<Uint8Array<ArrayBuffer>> {
  const rootCryptoKey = await importHkdfRootKey(input.rootKey);
  const bits = await crypto.subtle.deriveBits(
    {
      hash: "SHA-256",
      info: localSecretAdditionalData(
        localSecretContext(input.scope, input.purpose),
      ),
      name: "HKDF",
      salt: localKeyringSalt(input.scope),
    },
    rootCryptoKey,
    256,
  );

  return new Uint8Array(bits);
}

export function assertEnvelopeContextMatches(input: {
  readonly actual: LocalSecretContext;
  readonly expected: LocalSecretContext;
}): void {
  if (
    canonicalLocalSecretContext(input.actual) !==
    canonicalLocalSecretContext(input.expected)
  ) {
    throw new Error("Wrapped local secret context does not match.");
  }
}

export function assertWrappedLocalSecretEnvelope(
  envelope: WrappedLocalSecretEnvelope,
): void {
  if (envelope.format !== WRAPPED_LOCAL_SECRET_FORMAT) {
    throw new Error("Wrapped local secret envelope format is unsupported.");
  }
  if (envelope.version !== 1) {
    throw new Error("Wrapped local secret envelope version is unsupported.");
  }
  assertNonEmptyString(envelope.algorithm, "Wrapped local secret algorithm");
  assertNonEmptyString(envelope.ciphertext, "Wrapped local secret ciphertext");
  assertNonEmptyString(envelope.keyId, "Wrapped local secret key id");
  assertNonEmptyString(envelope.provider, "Wrapped local secret provider");
  assertNonEmptyString(envelope.wrappedAt, "Wrapped local secret wrappedAt");
  normalizeLocalKeyringScope(envelope.context.scope);
  assertNonEmptyString(
    envelope.context.purpose,
    "Wrapped local secret purpose",
  );
}

function assertLocalKeyringManifest(manifest: LocalKeyringManifest): void {
  if (manifest.format !== LOCAL_KEYRING_MANIFEST_FORMAT) {
    throw new Error("Local keyring manifest format is unsupported.");
  }
  if (manifest.version !== 1) {
    throw new Error("Local keyring manifest version is unsupported.");
  }
  assertNonEmptyString(manifest.createdAt, "Local keyring manifest createdAt");
  assertNonEmptyString(manifest.updatedAt, "Local keyring manifest updatedAt");
  const scope = normalizeLocalKeyringScope(manifest.scope);
  assertWrappedLocalSecretEnvelope(manifest.rootKeyEnvelope);
  assertEnvelopeContextMatches({
    actual: manifest.rootKeyEnvelope.context,
    expected: localSecretContext(scope, "account-root"),
  });
}

function cloneManifest(manifest: LocalKeyringManifest): LocalKeyringManifest {
  return parseLocalKeyringManifest(serializeLocalKeyringManifest(manifest));
}

export function serializeLocalKeyringManifest(
  manifest: LocalKeyringManifest,
): string {
  assertLocalKeyringManifest(manifest);
  return JSON.stringify(manifest);
}

type ParsedObject = ReadonlyMap<string, unknown>;

function readObject(value: unknown, label: string): ParsedObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }

  return new Map(Object.entries(value));
}

function readString(value: ParsedObject, key: string): string {
  const field = value.get(key);
  if (typeof field !== "string" || field.length === 0) {
    throw new Error(`${key} must be a non-empty string.`);
  }

  return field;
}

function readExactString<const ExpectedValue extends string>(
  value: ParsedObject,
  key: string,
  expectedValue: ExpectedValue,
): ExpectedValue {
  const field = readString(value, key);
  if (field !== expectedValue) {
    throw new Error(`${key} must be ${expectedValue}.`);
  }

  return expectedValue;
}

function readLocalKeyPurpose(
  value: ParsedObject,
  key: string,
): LocalKeyPurpose {
  return readString(value, key);
}

function readOptionalString(
  value: ParsedObject,
  key: string,
): string | undefined {
  const field = value.get(key);
  if (field === undefined) {
    return undefined;
  }
  if (typeof field !== "string" || field.length === 0) {
    throw new Error(`${key} must be a non-empty string.`);
  }

  return field;
}

function readNullableString(value: ParsedObject, key: string): string | null {
  const field = value.get(key);
  if (field === null) {
    return null;
  }
  if (typeof field !== "string" || field.length === 0) {
    throw new Error(`${key} must be a non-empty string or null.`);
  }

  return field;
}

function readVersion1(value: ParsedObject): 1 {
  if (value.get("version") !== 1) {
    throw new Error("version must be 1.");
  }

  return 1;
}

function readLocalKeyringScope(value: unknown): NormalizedLocalKeyringScope {
  const scope = readObject(value, "scope");
  return normalizeLocalKeyringScope({
    accountId: readNullableString(scope, "accountId"),
    namespace: readString(scope, "namespace"),
    signingFingerprint: readNullableString(scope, "signingFingerprint"),
  });
}

function readLocalSecretContext(value: unknown): LocalSecretContext {
  const context = readObject(value, "context");
  return localSecretContext(
    readLocalKeyringScope(context.get("scope")),
    readLocalKeyPurpose(context, "purpose"),
  );
}

function readWrappedLocalSecretEnvelope(
  value: unknown,
): WrappedLocalSecretEnvelope {
  const envelope = readObject(value, "rootKeyEnvelope");
  const parsed = {
    algorithm: readString(envelope, "algorithm"),
    ciphertext: readString(envelope, "ciphertext"),
    context: readLocalSecretContext(envelope.get("context")),
    format: readExactString(envelope, "format", WRAPPED_LOCAL_SECRET_FORMAT),
    iv: readOptionalString(envelope, "iv"),
    keyId: readString(envelope, "keyId"),
    provider: readString(envelope, "provider"),
    version: readVersion1(envelope),
    wrappedAt: readString(envelope, "wrappedAt"),
  } satisfies WrappedLocalSecretEnvelope;
  assertWrappedLocalSecretEnvelope(parsed);
  return parsed;
}

export function parseLocalKeyringManifest(
  value: unknown,
): LocalKeyringManifest {
  const parsedValue: unknown =
    typeof value === "string" ? JSON.parse(value) : value;
  const manifest = readObject(parsedValue, "manifest");
  const parsed = {
    createdAt: readString(manifest, "createdAt"),
    format: readExactString(manifest, "format", LOCAL_KEYRING_MANIFEST_FORMAT),
    rootKeyEnvelope: readWrappedLocalSecretEnvelope(
      manifest.get("rootKeyEnvelope"),
    ),
    scope: readLocalKeyringScope(manifest.get("scope")),
    updatedAt: readString(manifest, "updatedAt"),
    version: readVersion1(manifest),
  } satisfies LocalKeyringManifest;
  assertLocalKeyringManifest(parsed);
  return parsed;
}

class MemoryLocalKeyringManifestStore implements LocalKeyringManifestStore {
  private readonly manifestsByScopeKey = new Map<
    string,
    LocalKeyringManifest
  >();

  async deleteManifest(scope: LocalKeyringScope): Promise<void> {
    this.manifestsByScopeKey.delete(localKeyringScopeKey(scope));
  }

  async loadManifest(
    scope: LocalKeyringScope,
  ): Promise<LocalKeyringManifest | null> {
    const manifest = this.manifestsByScopeKey.get(localKeyringScopeKey(scope));
    return manifest ? cloneManifest(manifest) : null;
  }

  async saveManifest(manifest: LocalKeyringManifest): Promise<void> {
    this.manifestsByScopeKey.set(
      localKeyringScopeKey(manifest.scope),
      cloneManifest(manifest),
    );
  }
}

function getDefaultLocalKeyringManifestStorage(): LocalKeyringManifestStorage {
  if (typeof globalThis.localStorage === "undefined") {
    throw new Error("Browser local keyring manifest storage is unavailable.");
  }

  return globalThis.localStorage;
}

class LocalStorageLocalKeyringManifestStore
  implements LocalKeyringManifestStore
{
  private readonly prefix: string;
  private readonly storage: LocalKeyringManifestStorage;

  constructor(
    options: LocalStorageLocalKeyringManifestStoreOptions | undefined,
  ) {
    this.prefix = options?.prefix ?? LOCAL_STORAGE_MANIFEST_PREFIX;
    this.storage = options?.storage ?? getDefaultLocalKeyringManifestStorage();
  }

  async deleteManifest(scope: LocalKeyringScope): Promise<void> {
    this.storage.removeItem(this.storageKey(scope));
  }

  async loadManifest(
    scope: LocalKeyringScope,
  ): Promise<LocalKeyringManifest | null> {
    const serialized = this.storage.getItem(this.storageKey(scope));
    return serialized ? parseLocalKeyringManifest(serialized) : null;
  }

  async saveManifest(manifest: LocalKeyringManifest): Promise<void> {
    this.storage.setItem(
      this.storageKey(manifest.scope),
      serializeLocalKeyringManifest(manifest),
    );
  }

  private storageKey(scope: LocalKeyringScope): string {
    return `${this.prefix}${localKeyringScopeKey(scope)}`;
  }
}

/**
 * IndexedDB database/store holding one manifest record per keyring scope, kept
 * separate from the wrapping-key database so the two never coordinate versions.
 */
const BROWSER_KEYRING_MANIFEST_DATABASE_NAME =
  "tearleads-local-keyring-manifests";
const BROWSER_KEYRING_MANIFEST_STORE_NAME = "manifests";

export interface IndexedDbLocalKeyringManifestStoreOptions {
  readonly databaseName?: string | undefined;
  readonly indexedDB?: IDBFactory | undefined;
  readonly objectStoreName?: string | undefined;
}

function isIndexedDbAvailable(): boolean {
  // Require a usable factory, not merely a defined global: test environments stub
  // `indexedDB` with a non-functional placeholder, and a real persistent database
  // (which needs a working IndexedDB anyway) is the only place this store runs.
  return (
    typeof globalThis.indexedDB === "object" &&
    globalThis.indexedDB !== null &&
    typeof globalThis.indexedDB.open === "function"
  );
}

function getDefaultIndexedDb(): IDBFactory {
  if (!isIndexedDbAvailable()) {
    throw new Error(
      "Browser local keyring manifest storage requires IndexedDB.",
    );
  }
  return globalThis.indexedDB;
}

function readManifestRecordValue(record: unknown): string | null {
  if (typeof record !== "object" || record === null) {
    return null;
  }
  const manifest = Reflect.get(record, "manifest");
  return typeof manifest === "string" ? manifest : null;
}

/**
 * Persists keyring manifests in IndexedDB, where the wrapping key already lives.
 * The point is shared eviction fate: the manifest holds the wrapped root key that
 * derives the database's cipher key, so storing it in localStorage (evicted far
 * more aggressively — e.g. Safari ITP's script-writable-storage cap) lets the
 * keyring be lost while the OPFS-persisted, encrypted database survives, minting a
 * fresh root on the next boot and yielding SQLITE_NOTADB. IndexedDB shares the
 * origin's storage bucket with OPFS, so the manifest and database are evicted
 * together (a clean reset) or survive together — and unlike main-thread OPFS file
 * writes (unsupported on WebKit), IndexedDB works in every context the keyring
 * runs in.
 */
class IndexedDbLocalKeyringManifestStore implements LocalKeyringManifestStore {
  private readonly connection: IndexedDbStoreConnection;

  constructor(options: IndexedDbLocalKeyringManifestStoreOptions = {}) {
    const databaseName =
      options.databaseName ?? BROWSER_KEYRING_MANIFEST_DATABASE_NAME;
    const objectStoreName =
      options.objectStoreName ?? BROWSER_KEYRING_MANIFEST_STORE_NAME;
    assertNonEmptyString(databaseName, "IndexedDB database name");
    assertNonEmptyString(objectStoreName, "IndexedDB object store name");
    this.connection = new IndexedDbStoreConnection({
      databaseName,
      indexedDB: options.indexedDB ?? getDefaultIndexedDb(),
      keyPath: "scopeKey",
      objectStoreName,
    });
  }

  close(): void {
    this.connection.close();
  }

  async deleteManifest(scope: LocalKeyringScope): Promise<void> {
    await this.write((store) => store.delete(localKeyringScopeKey(scope)));
  }

  async loadManifest(
    scope: LocalKeyringScope,
  ): Promise<LocalKeyringManifest | null> {
    const record = await this.read(localKeyringScopeKey(scope));
    const serialized = readManifestRecordValue(record);
    return serialized ? parseLocalKeyringManifest(serialized) : null;
  }

  async saveManifest(manifest: LocalKeyringManifest): Promise<void> {
    await this.write((store) =>
      store.put({
        scopeKey: localKeyringScopeKey(manifest.scope),
        manifest: serializeLocalKeyringManifest(manifest),
      }),
    );
  }

  private async read(scopeKey: string): Promise<unknown> {
    return this.connection.request("readonly", (store) => store.get(scopeKey));
  }

  private async write<T>(
    operation: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    return this.connection.request("readwrite", operation);
  }
}

interface IndexedDbWrappingKeyRecord {
  readonly createdAt: string;
  // Exactly one of `key` / `keyMaterial` is set, per the keystore's
  // keyMaterialStorage mode. `key` holds a live non-extractable CryptoKey;
  // `keyMaterial` holds exported raw AES-GCM bytes for WebView shells that
  // cannot structured-clone a CryptoKey (see WrappingKeyMaterialStorage).
  readonly key?: CryptoKey;
  readonly keyId: string;
  readonly keyMaterial?: Uint8Array;
  readonly provider: string;
}

function hasErrorName(error: unknown, expectedName: string): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  if (
    "name" in error &&
    typeof error.name === "string" &&
    error.name === expectedName
  ) {
    return true;
  }
  if ("cause" in error) {
    return hasErrorName(error.cause, expectedName);
  }

  return false;
}

function isCryptoKey(value: unknown): value is CryptoKey {
  return typeof CryptoKey !== "undefined" && value instanceof CryptoKey;
}

function assertAesGcmWrappingCryptoKey(key: CryptoKey): void {
  const algorithm = key.algorithm;
  const algorithmLength =
    "length" in algorithm && typeof algorithm.length === "number"
      ? algorithm.length
      : null;
  if (
    key.type !== "secret" ||
    key.extractable ||
    algorithm.name !== "AES-GCM" ||
    algorithmLength !== 256 ||
    !key.usages.includes("decrypt") ||
    !key.usages.includes("encrypt")
  ) {
    throw new Error(
      "IndexedDB wrapping key must be a non-extractable AES-GCM secret key.",
    );
  }
}

function readWrappingKeyMaterial(value: unknown): Uint8Array {
  const bytes =
    value instanceof Uint8Array
      ? value
      : value instanceof ArrayBuffer
        ? new Uint8Array(value)
        : null;
  if (!bytes || bytes.byteLength !== WRAPPING_KEY_BYTES) {
    throw new Error(
      "IndexedDB wrapping key material must be 32 raw AES-256 bytes.",
    );
  }
  return bytes;
}

// Re-import the persisted raw bytes as a non-extractable runtime key: the bytes
// at rest are extractable (that is the cost of the "raw-bytes" mode), but the
// in-memory CryptoKey handed to encrypt/decrypt stays non-extractable. The
// temporary copy is wiped once WebCrypto has imported it so the raw key material
// does not linger in memory.
async function importRawWrappingKey(
  keyMaterial: Uint8Array,
): Promise<CryptoKey> {
  const keyBytes = copyBytes(keyMaterial);
  try {
    return await crypto.subtle.importKey(
      "raw",
      keyBytes,
      { length: 256, name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"],
    );
  } finally {
    keyBytes.fill(0);
  }
}

function readIndexedDbWrappingKeyRecord(input: {
  readonly keyId: string;
  readonly keyMaterialStorage: WrappingKeyMaterialStorage;
  readonly provider: string;
  readonly value: unknown;
}): IndexedDbWrappingKeyRecord {
  const record = readObject(input.value, "IndexedDB wrapping key record");
  const keyId = readString(record, "keyId");
  if (keyId !== input.keyId) {
    throw new Error("IndexedDB wrapping key id does not match.");
  }
  const provider = readString(record, "provider");
  if (provider !== input.provider) {
    throw new Error("IndexedDB wrapping key provider does not match.");
  }
  const createdAt = readString(record, "createdAt");
  if (input.keyMaterialStorage === "raw-bytes") {
    const keyMaterial = record.get("keyMaterial");
    if (keyMaterial === undefined) {
      throw new Error(
        "IndexedDB wrapping key record is missing its raw key material.",
      );
    }
    return {
      createdAt,
      keyId,
      keyMaterial: readWrappingKeyMaterial(keyMaterial),
      provider,
    };
  }
  const key = record.get("key");
  if (!isCryptoKey(key)) {
    throw new Error("IndexedDB wrapping key record is missing its CryptoKey.");
  }
  assertAesGcmWrappingCryptoKey(key);

  return { createdAt, key, keyId, provider };
}

function getDefaultIndexedDbFactory(): IDBFactory {
  if (typeof globalThis.indexedDB === "undefined") {
    throw new Error("Browser local keyring IndexedDB is unavailable.");
  }

  return globalThis.indexedDB;
}

class IndexedDbWrappingKeyKeystore implements WrappingKeyKeystore {
  readonly provider: string;
  private readonly connection: IndexedDbStoreConnection;
  private readonly keyMaterialStorage: WrappingKeyMaterialStorage;

  constructor(options: IndexedDbWrappingKeyKeystoreOptions | undefined) {
    const databaseName = options?.databaseName ?? BROWSER_KEYRING_DATABASE_NAME;
    this.keyMaterialStorage =
      options?.keyMaterialStorage ?? DEFAULT_WRAPPING_KEY_MATERIAL_STORAGE;
    const objectStoreName =
      options?.objectStoreName ?? BROWSER_WRAPPING_KEYS_STORE_NAME;
    this.provider = options?.provider ?? BROWSER_INDEXED_DB_PROVIDER;

    assertNonEmptyString(databaseName, "IndexedDB database name");
    assertNonEmptyString(objectStoreName, "IndexedDB object store name");
    assertNonEmptyString(this.provider, "IndexedDB wrapping key provider");
    this.connection = new IndexedDbStoreConnection({
      databaseName,
      indexedDB: options?.indexedDB ?? getDefaultIndexedDbFactory(),
      keyPath: "keyId",
      objectStoreName,
    });
  }

  close(): void {
    this.connection.close();
  }

  async deleteWrappingKey(scope: LocalKeyringScope): Promise<void> {
    await this.deleteStoredKey(await this.wrappingKeyId(scope));
  }

  async getOrCreateWrappingKey(
    scope: LocalKeyringScope,
  ): Promise<WrappingKeyHandle> {
    const keyId = await this.wrappingKeyId(scope);
    const existingKey = await this.loadStoredKey(keyId);
    if (existingKey) {
      return { keyId, provider: this.provider };
    }

    const record: IndexedDbWrappingKeyRecord = {
      createdAt: new Date().toISOString(),
      keyId,
      provider: this.provider,
      ...(await this.createWrappingKeyMaterial()),
    };
    try {
      await this.addStoredKey(record);
    } catch (error) {
      if (!hasErrorName(error, "ConstraintError")) {
        throw error;
      }
      const racedKey = await this.loadStoredKey(keyId);
      if (!racedKey) {
        throw error;
      }
    } finally {
      // IndexedDB serializes the value when add() is called, so the freshly
      // generated raw key bytes can be wiped from memory once the write settles.
      record.keyMaterial?.fill(0);
    }

    return { keyId, provider: this.provider };
  }

  async unwrapSecret({
    context,
    envelope,
  }: UnwrapLocalSecretInput): Promise<Uint8Array<ArrayBuffer>> {
    assertWrappedLocalSecretEnvelope(envelope);
    assertEnvelopeContextMatches({
      actual: envelope.context,
      expected: context,
    });
    if (envelope.provider !== this.provider) {
      throw new Error("Wrapped local secret provider is unsupported.");
    }
    if (envelope.algorithm !== AES_GCM_WRAPPING_ALGORITHM) {
      throw new Error("Wrapped local secret algorithm is unsupported.");
    }
    if (!envelope.iv) {
      throw new Error("Wrapped local secret IV is required.");
    }

    const key = await this.loadStoredKey(envelope.keyId);
    if (!key) {
      throw new Error("Wrapping key is unavailable.");
    }

    try {
      return new Uint8Array(
        await crypto.subtle.decrypt(
          {
            additionalData: localSecretAdditionalData(context),
            iv: copyBytes(base64ToBytes(envelope.iv)),
            name: "AES-GCM",
          },
          key,
          copyBytes(base64ToBytes(envelope.ciphertext)),
        ),
      );
    } catch (error) {
      throw new Error("Wrapped local secret could not be unwrapped.", {
        cause: error,
      });
    }
  }

  async wrapSecret({
    context,
    handle,
    plaintext,
  }: WrapLocalSecretInput): Promise<WrappedLocalSecretEnvelope> {
    if (handle.provider !== this.provider) {
      throw new Error("Wrapping key handle provider is unsupported.");
    }
    const key = await this.loadStoredKey(handle.keyId);
    if (!key) {
      throw new Error("Wrapping key is unavailable.");
    }
    const iv = randomBytes(AES_GCM_IV_BYTES);
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt(
        {
          additionalData: localSecretAdditionalData(context),
          iv,
          name: "AES-GCM",
        },
        key,
        copyBytes(plaintext),
      ),
    );

    return {
      algorithm: AES_GCM_WRAPPING_ALGORITHM,
      ciphertext: bytesToBase64(ciphertext),
      context,
      format: WRAPPED_LOCAL_SECRET_FORMAT,
      iv: bytesToBase64(iv),
      keyId: handle.keyId,
      provider: this.provider,
      version: 1,
      wrappedAt: new Date().toISOString(),
    };
  }

  // Mints fresh wrapping-key material in whichever shape this keystore persists:
  // a live non-extractable CryptoKey ("crypto-key"), or exported raw AES-256
  // bytes ("raw-bytes") for WebView shells that cannot structured-clone a
  // CryptoKey into IndexedDB.
  private async createWrappingKeyMaterial(): Promise<
    Pick<IndexedDbWrappingKeyRecord, "key" | "keyMaterial">
  > {
    if (this.keyMaterialStorage === "raw-bytes") {
      const key = await crypto.subtle.generateKey(
        { length: 256, name: "AES-GCM" },
        true,
        ["encrypt", "decrypt"],
      );
      const keyMaterial = new Uint8Array(
        await crypto.subtle.exportKey("raw", key),
      );
      return { keyMaterial: readWrappingKeyMaterial(keyMaterial) };
    }

    const key = await crypto.subtle.generateKey(
      { length: 256, name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"],
    );
    assertAesGcmWrappingCryptoKey(key);
    return { key };
  }

  private addStoredKey(
    record: IndexedDbWrappingKeyRecord,
  ): Promise<IDBValidKey> {
    return this.writeStoredKey((store) => store.add(record));
  }

  private async deleteStoredKey(keyId: string): Promise<void> {
    await this.writeStoredKey((store) => store.delete(keyId));
  }

  private async loadStoredKey(keyId: string): Promise<CryptoKey | null> {
    const record = await this.readStoredKey(keyId);
    if (record === undefined) {
      return null;
    }

    const parsed = readIndexedDbWrappingKeyRecord({
      keyId,
      keyMaterialStorage: this.keyMaterialStorage,
      provider: this.provider,
      value: record,
    });
    if (parsed.key) {
      return parsed.key;
    }

    // Wipe the raw bytes read out of IndexedDB once they have been imported.
    const keyMaterial = readWrappingKeyMaterial(parsed.keyMaterial);
    try {
      return await importRawWrappingKey(keyMaterial);
    } finally {
      keyMaterial.fill(0);
    }
  }

  private async readStoredKey(keyId: string): Promise<unknown | undefined> {
    return this.connection.request("readonly", (store) => store.get(keyId));
  }

  private async writeStoredKey<T>(
    operation: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    return this.connection.request("readwrite", operation);
  }

  private async wrappingKeyId(scope: LocalKeyringScope): Promise<string> {
    return `indexeddb:${await localWrappingKeyScopeHash(
      normalizeLocalKeyringScope(scope),
    )}`;
  }
}

class MemoryWrappingKeyKeystore implements WrappingKeyKeystore {
  readonly provider = "memory";
  private readonly keysById = new Map<string, CryptoKey>();

  async deleteWrappingKey(scope: LocalKeyringScope): Promise<void> {
    const keyId = await memoryWrappingKeyId(normalizeLocalKeyringScope(scope));
    this.keysById.delete(keyId);
  }

  async getOrCreateWrappingKey(
    scope: LocalKeyringScope,
  ): Promise<WrappingKeyHandle> {
    const normalizedScope = normalizeLocalKeyringScope(scope);
    const keyId = await memoryWrappingKeyId(normalizedScope);
    if (!this.keysById.has(keyId)) {
      this.keysById.set(
        keyId,
        await crypto.subtle.generateKey(
          { length: 256, name: "AES-GCM" },
          false,
          ["encrypt", "decrypt"],
        ),
      );
    }

    return { keyId, provider: this.provider };
  }

  async unwrapSecret({
    context,
    envelope,
  }: UnwrapLocalSecretInput): Promise<Uint8Array<ArrayBuffer>> {
    assertWrappedLocalSecretEnvelope(envelope);
    assertEnvelopeContextMatches({
      actual: envelope.context,
      expected: context,
    });
    if (envelope.provider !== this.provider) {
      throw new Error("Wrapped local secret provider is unsupported.");
    }
    if (envelope.algorithm !== AES_GCM_WRAPPING_ALGORITHM) {
      throw new Error("Wrapped local secret algorithm is unsupported.");
    }
    if (!envelope.iv) {
      throw new Error("Wrapped local secret IV is required.");
    }

    const key = this.keysById.get(envelope.keyId);
    if (!key) {
      throw new Error("Wrapping key is unavailable.");
    }

    try {
      return new Uint8Array(
        await crypto.subtle.decrypt(
          {
            additionalData: localSecretAdditionalData(context),
            iv: copyBytes(base64ToBytes(envelope.iv)),
            name: "AES-GCM",
          },
          key,
          copyBytes(base64ToBytes(envelope.ciphertext)),
        ),
      );
    } catch (error) {
      throw new Error("Wrapped local secret could not be unwrapped.", {
        cause: error,
      });
    }
  }

  async wrapSecret({
    context,
    handle,
    plaintext,
  }: WrapLocalSecretInput): Promise<WrappedLocalSecretEnvelope> {
    if (handle.provider !== this.provider) {
      throw new Error("Wrapping key handle provider is unsupported.");
    }
    const key = this.keysById.get(handle.keyId);
    if (!key) {
      throw new Error("Wrapping key is unavailable.");
    }
    const iv = randomBytes(AES_GCM_IV_BYTES);
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt(
        {
          additionalData: localSecretAdditionalData(context),
          iv,
          name: "AES-GCM",
        },
        key,
        copyBytes(plaintext),
      ),
    );

    return {
      algorithm: AES_GCM_WRAPPING_ALGORITHM,
      ciphertext: bytesToBase64(ciphertext),
      context,
      format: WRAPPED_LOCAL_SECRET_FORMAT,
      iv: bytesToBase64(iv),
      keyId: handle.keyId,
      provider: this.provider,
      version: 1,
      wrappedAt: new Date().toISOString(),
    };
  }
}

class LocalKeyringSessionImpl implements LocalKeyringSession {
  readonly blobStoreKey: Uint8Array<ArrayBuffer>;
  readonly identityPersistenceKey: Uint8Array<ArrayBuffer>;
  readonly scope: NormalizedLocalKeyringScope;
  readonly sqliteKey: string;

  private disposed = false;

  private constructor(
    readonly manifest: LocalKeyringManifest,
    private readonly rootKey: Uint8Array<ArrayBuffer>,
    derivedKeys: {
      readonly blobStoreKey: Uint8Array<ArrayBuffer>;
      readonly identityPersistenceKey: Uint8Array<ArrayBuffer>;
      readonly sqliteKey: string;
    },
  ) {
    this.scope = manifest.scope;
    this.blobStoreKey = derivedKeys.blobStoreKey;
    this.identityPersistenceKey = derivedKeys.identityPersistenceKey;
    this.sqliteKey = derivedKeys.sqliteKey;
  }

  static async create(input: {
    readonly manifest: LocalKeyringManifest;
    readonly rootKey: Uint8Array;
  }): Promise<LocalKeyringSession> {
    const rootKey = copyBytes(input.rootKey);
    const [sqliteKeyMaterial, blobStoreKey, identityPersistenceKey] =
      await Promise.all([
        deriveLocalSecretKey({
          purpose: "sqlite",
          rootKey,
          scope: input.manifest.scope,
        }),
        deriveLocalSecretKey({
          purpose: "blob-store",
          rootKey,
          scope: input.manifest.scope,
        }),
        deriveLocalSecretKey({
          purpose: "identity-persistence",
          rootKey,
          scope: input.manifest.scope,
        }),
      ]);

    const sqliteKey = bytesToBase64(sqliteKeyMaterial);
    sqliteKeyMaterial.fill(0);

    return new LocalKeyringSessionImpl(input.manifest, rootKey, {
      blobStoreKey,
      identityPersistenceKey,
      sqliteKey,
    });
  }

  async deriveKey(purpose: LocalKeyPurpose): Promise<Uint8Array<ArrayBuffer>> {
    if (this.disposed) {
      throw new Error("Local keyring session has been disposed.");
    }

    return deriveLocalSecretKey({
      purpose,
      rootKey: this.rootKey,
      scope: this.scope,
    });
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.rootKey.fill(0);
    this.blobStoreKey.fill(0);
    this.identityPersistenceKey.fill(0);
    this.disposed = true;
  }

  isDisposed(): boolean {
    return this.disposed;
  }
}

function isDisposedLocalKeyringSession(session: LocalKeyringSession): boolean {
  return session instanceof LocalKeyringSessionImpl && session.isDisposed();
}

type LocalKeyringServiceOptions = Omit<LocalKeyringOptions, "now"> & {
  readonly now: () => Date;
};

class LocalKeyringService implements LocalKeyring {
  private readonly sessionOperationsByScopeKey = new Map<
    string,
    Promise<LocalKeyringSession>
  >();
  private closed = false;

  constructor(private readonly options: LocalKeyringServiceOptions) {}

  close(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    // The cache is non-owning: callers may still be using returned sessions,
    // including sessions produced by operations that are currently in flight.
    this.sessionOperationsByScopeKey.clear();
    try {
      this.options.manifestStore.close?.();
    } finally {
      this.options.keystore.close?.();
    }
  }

  async deleteSession(scope: LocalKeyringScope): Promise<void> {
    this.assertOpen();
    const scopeKey = localKeyringScopeKey(scope);
    const currentOperation = this.sessionOperationsByScopeKey.get(scopeKey);
    this.sessionOperationsByScopeKey.delete(scopeKey);
    const currentSession = await currentOperation?.catch(() => null);
    currentSession?.dispose();
    await this.options.manifestStore.deleteManifest(scope);
    await this.options.keystore.deleteWrappingKey(scope);
  }

  async getOrCreateSession(
    scope: LocalKeyringScope,
  ): Promise<LocalKeyringSession> {
    this.assertOpen();
    const scopeKey = localKeyringScopeKey(scope);
    const currentOperation = this.sessionOperationsByScopeKey.get(scopeKey);
    if (currentOperation) {
      const session = await currentOperation;
      if (!isDisposedLocalKeyringSession(session)) {
        return session;
      }

      if (this.sessionOperationsByScopeKey.get(scopeKey) === currentOperation) {
        this.sessionOperationsByScopeKey.delete(scopeKey);
      }
      return this.getOrCreateSession(scope);
    }

    const operation = this.loadOrCreateSession(scope);
    this.sessionOperationsByScopeKey.set(scopeKey, operation);
    try {
      return await operation;
    } catch (error) {
      if (this.sessionOperationsByScopeKey.get(scopeKey) === operation) {
        this.sessionOperationsByScopeKey.delete(scopeKey);
      }
      throw error;
    }
  }

  async loadSession(
    scope: LocalKeyringScope,
  ): Promise<LocalKeyringSession | null> {
    this.assertOpen();
    const manifest = await this.options.manifestStore.loadManifest(scope);
    if (!manifest) {
      return null;
    }

    return this.openSession(manifest);
  }

  private async loadOrCreateSession(
    scope: LocalKeyringScope,
  ): Promise<LocalKeyringSession> {
    return (
      (await this.loadSession(scope)) ??
      this.createSession(normalizeLocalKeyringScope(scope))
    );
  }

  private async createSession(
    scope: NormalizedLocalKeyringScope,
  ): Promise<LocalKeyringSession> {
    const rootKey = randomBytes(LOCAL_ROOT_KEY_BYTES);
    const handle = await this.options.keystore.getOrCreateWrappingKey(scope);
    const now = this.options.now().toISOString();
    const manifest: LocalKeyringManifest = {
      createdAt: now,
      format: LOCAL_KEYRING_MANIFEST_FORMAT,
      rootKeyEnvelope: await this.options.keystore.wrapSecret({
        context: localSecretContext(scope, "account-root"),
        handle,
        plaintext: rootKey,
      }),
      scope,
      updatedAt: now,
      version: 1,
    };
    await this.options.manifestStore.saveManifest(manifest);
    return LocalKeyringSessionImpl.create({ manifest, rootKey });
  }

  private async openSession(
    manifest: LocalKeyringManifest,
  ): Promise<LocalKeyringSession> {
    assertLocalKeyringManifest(manifest);
    const rootKey = await this.options.keystore.unwrapSecret({
      context: localSecretContext(manifest.scope, "account-root"),
      envelope: manifest.rootKeyEnvelope,
    });

    return LocalKeyringSessionImpl.create({ manifest, rootKey });
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error("Local keyring is closed.");
    }
  }
}

export function createLocalKeyring(options: LocalKeyringOptions): LocalKeyring {
  return new LocalKeyringService({
    ...options,
    now: options.now ?? (() => new Date()),
  });
}

export function createBrowserLocalKeyring(
  options: BrowserLocalKeyringOptions = {},
): LocalKeyring {
  return createLocalKeyring({
    keystore: createIndexedDbWrappingKeyKeystore({
      databaseName: options.databaseName,
      indexedDB: options.indexedDB,
      keyMaterialStorage: options.keyMaterialStorage,
      objectStoreName: options.objectStoreName,
      provider: options.provider,
    }),
    manifestStore:
      options.manifestStore ??
      (options.manifestStorage
        ? createLocalStorageLocalKeyringManifestStore({
            prefix: options.manifestStoragePrefix,
            storage: options.manifestStorage,
          })
        : createBrowserLocalKeyringManifestStore({
            indexedDB: options.indexedDB,
            prefix: options.manifestStoragePrefix,
          })),
    now: options.now,
  });
}

/**
 * Browser local keyring tuned for WKWebView-based desktop/mobile shells
 * (Electrobun, Capacitor). Identical to {@link createBrowserLocalKeyring} except
 * the IndexedDB wrapping key is persisted as raw exported bytes instead of a live
 * CryptoKey object. WKWebView serializes a CryptoKey by writing a "WebCrypto
 * master key" to the macOS keychain, which fails with `errSecInteractionNotAllowed`
 * (-25308) in an unsigned app and aborts the IndexedDB write (and can crash the
 * WebContent process). Persisting raw bytes avoids the keychain entirely, at the
 * cost of an extractable wrapping key at rest — acceptable for a local shell whose
 * IndexedDB is already only reachable by the signed-in OS user.
 */
export function createWebViewLocalKeyring(
  options: BrowserLocalKeyringOptions = {},
): LocalKeyring {
  return createBrowserLocalKeyring({
    ...options,
    keyMaterialStorage: options.keyMaterialStorage ?? "raw-bytes",
  });
}

export function createIndexedDbWrappingKeyKeystore(
  options: IndexedDbWrappingKeyKeystoreOptions = {},
): WrappingKeyKeystore {
  return new IndexedDbWrappingKeyKeystore(options);
}

export function createLocalStorageLocalKeyringManifestStore(
  options: LocalStorageLocalKeyringManifestStoreOptions = {},
): LocalKeyringManifestStore {
  return new LocalStorageLocalKeyringManifestStore(options);
}

export function createIndexedDbLocalKeyringManifestStore(
  options: IndexedDbLocalKeyringManifestStoreOptions = {},
): LocalKeyringManifestStore {
  return new IndexedDbLocalKeyringManifestStore(options);
}

/**
 * Selects the manifest store for a browser keyring: IndexedDB when available (so
 * the manifest shares the OPFS-persisted database's eviction bucket — the fix for
 * the cipher-key/database desync that produced SQLITE_NOTADB — and lives where the
 * wrapping key already does), otherwise localStorage. Falling back to localStorage
 * is safe precisely where IndexedDB is absent: there is no persistent database to
 * desync from in that case.
 */
export function createBrowserLocalKeyringManifestStore(
  options: {
    readonly indexedDB?: IDBFactory | undefined;
    readonly prefix?: string | undefined;
    readonly storage?: LocalKeyringManifestStorage | undefined;
  } = {},
): LocalKeyringManifestStore {
  if (options.indexedDB || isIndexedDbAvailable()) {
    return createIndexedDbLocalKeyringManifestStore({
      indexedDB: options.indexedDB,
    });
  }
  return createLocalStorageLocalKeyringManifestStore({
    prefix: options.prefix,
    storage: options.storage,
  });
}

export function createMemoryLocalKeyringManifestStore(): LocalKeyringManifestStore {
  return new MemoryLocalKeyringManifestStore();
}

export function createMemoryWrappingKeyKeystore(): WrappingKeyKeystore {
  return new MemoryWrappingKeyKeystore();
}

export function decodeLocalKeyringSqliteKey(
  sqliteKey: string,
): Uint8Array<ArrayBuffer> {
  return copyBytes(base64ToBytes(sqliteKey));
}

export function encodeLocalKeyringSqliteKey(sqliteKey: Uint8Array): string {
  return bytesToBase64(sqliteKey);
}
