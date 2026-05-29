import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";

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
}

export interface LocalKeyring {
  deleteSession(scope: LocalKeyringScope): Promise<void>;
  getOrCreateSession(scope: LocalKeyringScope): Promise<LocalKeyringSession>;
  loadSession(scope: LocalKeyringScope): Promise<LocalKeyringSession | null>;
}

export interface LocalKeyringOptions {
  readonly keystore: WrappingKeyKeystore;
  readonly manifestStore: LocalKeyringManifestStore;
  readonly now?: (() => Date) | undefined;
}

const TEXT_ENCODER = new TextEncoder();
const LOCAL_ROOT_KEY_BYTES = 32;
const AES_GCM_IV_BYTES = 12;
const MEMORY_WRAPPING_ALGORITHM = "aes-256-gcm";

function asArrayBufferBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  if (bytes.buffer instanceof ArrayBuffer) {
    return bytes as Uint8Array<ArrayBuffer>;
  }

  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

function copyBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return asArrayBufferBytes(bytes.slice());
}

function randomBytes(byteLength: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(byteLength));
}

function assertNonEmptyString(value: string, label: string): void {
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

function localSecretContext(
  scope: NormalizedLocalKeyringScope,
  purpose: LocalKeyPurpose,
): LocalSecretContext {
  assertNonEmptyString(purpose, "Local key purpose");
  return { purpose, scope };
}

function canonicalLocalSecretContext(context: LocalSecretContext): string {
  return JSON.stringify({
    purpose: context.purpose,
    scope: normalizeLocalKeyringScope(context.scope),
  });
}

function localSecretAdditionalData(
  context: LocalSecretContext,
): Uint8Array<ArrayBuffer> {
  return asArrayBufferBytes(
    TEXT_ENCODER.encode(canonicalLocalSecretContext(context)),
  );
}

function localKeyringSalt(
  scope: NormalizedLocalKeyringScope,
): Uint8Array<ArrayBuffer> {
  return asArrayBufferBytes(
    TEXT_ENCODER.encode(
      `tearleads.local-keyring.v1.${localKeyringScopeKey(scope)}`,
    ),
  );
}

async function hashHex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", asArrayBufferBytes(bytes)),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

async function memoryWrappingKeyId(
  scope: NormalizedLocalKeyringScope,
): Promise<string> {
  const keyMaterial = TEXT_ENCODER.encode(
    `tearleads.memory-wrapping-key.v1.${localKeyringScopeKey(scope)}`,
  );
  return `memory:${await hashHex(keyMaterial)}`;
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

function assertEnvelopeContextMatches(input: {
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

function assertWrappedLocalSecretEnvelope(
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

function readObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function readString(value: Record<string, unknown>, key: string): string {
  const field = value[key];
  if (typeof field !== "string" || field.length === 0) {
    throw new Error(`${key} must be a non-empty string.`);
  }

  return field;
}

function readOptionalString(
  value: Record<string, unknown>,
  key: string,
): string | undefined {
  const field = value[key];
  if (field === undefined) {
    return undefined;
  }
  if (typeof field !== "string" || field.length === 0) {
    throw new Error(`${key} must be a non-empty string.`);
  }

  return field;
}

function readNullableString(
  value: Record<string, unknown>,
  key: string,
): string | null {
  const field = value[key];
  if (field === null) {
    return null;
  }
  if (typeof field !== "string" || field.length === 0) {
    throw new Error(`${key} must be a non-empty string or null.`);
  }

  return field;
}

function readVersion1(value: Record<string, unknown>): 1 {
  if (Reflect.get(value, "version") !== 1) {
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
    readLocalKeyringScope(Reflect.get(context, "scope")),
    readString(context, "purpose") as LocalKeyPurpose,
  );
}

function readWrappedLocalSecretEnvelope(
  value: unknown,
): WrappedLocalSecretEnvelope {
  const envelope = readObject(value, "rootKeyEnvelope");
  const parsed = {
    algorithm: readString(envelope, "algorithm"),
    ciphertext: readString(envelope, "ciphertext"),
    context: readLocalSecretContext(Reflect.get(envelope, "context")),
    format: readString(envelope, "format") as WrappedLocalSecretFormat,
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
  const parsedValue =
    typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  const manifest = readObject(parsedValue, "manifest");
  const parsed = {
    createdAt: readString(manifest, "createdAt"),
    format: readString(manifest, "format") as LocalKeyringManifestFormat,
    rootKeyEnvelope: readWrappedLocalSecretEnvelope(
      Reflect.get(manifest, "rootKeyEnvelope"),
    ),
    scope: readLocalKeyringScope(Reflect.get(manifest, "scope")),
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
    if (envelope.algorithm !== MEMORY_WRAPPING_ALGORITHM) {
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
            iv: asArrayBufferBytes(base64ToBytes(envelope.iv)),
            name: "AES-GCM",
          },
          key,
          asArrayBufferBytes(base64ToBytes(envelope.ciphertext)),
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
      algorithm: MEMORY_WRAPPING_ALGORITHM,
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

    return new LocalKeyringSessionImpl(input.manifest, rootKey, {
      blobStoreKey,
      identityPersistenceKey,
      sqliteKey: bytesToBase64(sqliteKeyMaterial),
    });
  }

  deriveKey(purpose: LocalKeyPurpose): Promise<Uint8Array<ArrayBuffer>> {
    return deriveLocalSecretKey({
      purpose,
      rootKey: this.rootKey,
      scope: this.scope,
    });
  }
}

type LocalKeyringServiceOptions = Omit<LocalKeyringOptions, "now"> & {
  readonly now: () => Date;
};

class LocalKeyringService implements LocalKeyring {
  private readonly sessionOperationsByScopeKey = new Map<
    string,
    Promise<LocalKeyringSession>
  >();

  constructor(private readonly options: LocalKeyringServiceOptions) {}

  async deleteSession(scope: LocalKeyringScope): Promise<void> {
    await this.options.manifestStore.deleteManifest(scope);
    await this.options.keystore.deleteWrappingKey(scope);
  }

  async getOrCreateSession(
    scope: LocalKeyringScope,
  ): Promise<LocalKeyringSession> {
    const scopeKey = localKeyringScopeKey(scope);
    const currentOperation = this.sessionOperationsByScopeKey.get(scopeKey);
    if (currentOperation) {
      return currentOperation;
    }

    const operation = this.loadOrCreateSession(scope);
    this.sessionOperationsByScopeKey.set(scopeKey, operation);
    try {
      return await operation;
    } finally {
      if (this.sessionOperationsByScopeKey.get(scopeKey) === operation) {
        this.sessionOperationsByScopeKey.delete(scopeKey);
      }
    }
  }

  async loadSession(
    scope: LocalKeyringScope,
  ): Promise<LocalKeyringSession | null> {
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
}

export function createLocalKeyring(options: LocalKeyringOptions): LocalKeyring {
  return new LocalKeyringService({
    ...options,
    now: options.now ?? (() => new Date()),
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
  return asArrayBufferBytes(base64ToBytes(sqliteKey));
}

export function encodeLocalKeyringSqliteKey(sqliteKey: Uint8Array): string {
  return bytesToBase64(sqliteKey);
}
