import {
  LOCAL_KEYRING_MANIFEST_FORMAT,
  type LocalKeyring,
  type LocalKeyringManifest,
  type LocalKeyringScope,
  type LocalKeyringSession,
  localKeyringScopeKey,
  normalizeLocalKeyringScope,
  WRAPPED_LOCAL_SECRET_FORMAT,
} from "@symcrypt/client-sdk";

export function createSharedMemoryLocalKeyringFactory(): () => LocalKeyring {
  const identityKeysByScopeKey = new Map<string, Uint8Array>();

  return () => ({
    close() {},
    async deleteSession(scope) {
      identityKeysByScopeKey.delete(localKeyringScopeKey(scope));
    },
    async getOrCreateSession(scope) {
      const scopeKey = localKeyringScopeKey(scope);
      let identityPersistenceKey = identityKeysByScopeKey.get(scopeKey);
      if (!identityPersistenceKey) {
        identityPersistenceKey = createTestKey(identityKeysByScopeKey.size + 1);
        identityKeysByScopeKey.set(scopeKey, identityPersistenceKey);
      }

      return createTestLocalKeyringSession(scope, identityPersistenceKey);
    },
    async loadSession(scope) {
      const identityPersistenceKey = identityKeysByScopeKey.get(
        localKeyringScopeKey(scope),
      );
      return identityPersistenceKey
        ? createTestLocalKeyringSession(scope, identityPersistenceKey)
        : null;
    },
  });
}

function createTestKey(seed: number): Uint8Array {
  const key = new Uint8Array(32);
  key.fill(seed % 256);
  return key;
}

function asArrayBufferBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

function createTestLocalKeyringManifest(
  scope: LocalKeyringScope,
): LocalKeyringManifest {
  const normalizedScope = normalizeLocalKeyringScope(scope);
  const now = new Date(0).toISOString();
  return {
    createdAt: now,
    format: LOCAL_KEYRING_MANIFEST_FORMAT,
    rootKeyEnvelope: {
      algorithm: "test",
      ciphertext: "test",
      context: {
        purpose: "account-root",
        scope: normalizedScope,
      },
      format: WRAPPED_LOCAL_SECRET_FORMAT,
      keyId: "test",
      provider: "test",
      version: 1,
      wrappedAt: now,
    },
    scope: normalizedScope,
    updatedAt: now,
    version: 1,
  };
}

function createTestLocalKeyringSession(
  scope: LocalKeyringScope,
  identityPersistenceKey: Uint8Array,
): LocalKeyringSession {
  const sessionIdentityPersistenceKey = asArrayBufferBytes(
    identityPersistenceKey,
  );
  return {
    blobStoreKey: asArrayBufferBytes(createTestKey(2)),
    identityPersistenceKey: sessionIdentityPersistenceKey,
    manifest: createTestLocalKeyringManifest(scope),
    scope: normalizeLocalKeyringScope(scope),
    sqliteKey: "test-sqlite-key",
    async deriveKey() {
      return asArrayBufferBytes(sessionIdentityPersistenceKey);
    },
    dispose() {
      sessionIdentityPersistenceKey.fill(0);
    },
  };
}
