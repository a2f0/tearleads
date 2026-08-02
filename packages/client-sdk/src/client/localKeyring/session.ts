import { bytesToBase64 } from "@tearleads/encoding";
import { copyBytes } from "./primitives";
import { deriveLocalSecretKey } from "./rootKey";
import type {
  LocalKeyPurpose,
  LocalKeyringManifest,
  LocalKeyringSession,
  NormalizedLocalKeyringScope,
} from "./types";

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

export function createLocalKeyringSession(input: {
  readonly manifest: LocalKeyringManifest;
  readonly rootKey: Uint8Array;
}): Promise<LocalKeyringSession> {
  return LocalKeyringSessionImpl.create(input);
}

export function isDisposedLocalKeyringSession(
  session: LocalKeyringSession,
): boolean {
  return session instanceof LocalKeyringSessionImpl && session.isDisposed();
}
