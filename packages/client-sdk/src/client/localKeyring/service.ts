import { assertLocalKeyringManifest } from "./manifest";
import { randomBytes } from "./primitives";
import { LOCAL_ROOT_KEY_BYTES } from "./rootKey";
import {
  localKeyringScopeKey,
  localSecretContext,
  normalizeLocalKeyringScope,
} from "./scope";
import {
  createLocalKeyringSession,
  isDisposedLocalKeyringSession,
} from "./session";
import {
  LOCAL_KEYRING_MANIFEST_FORMAT,
  type LocalKeyring,
  type LocalKeyringManifest,
  type LocalKeyringOptions,
  type LocalKeyringScope,
  type LocalKeyringSession,
  type NormalizedLocalKeyringScope,
} from "./types";

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
    return createLocalKeyringSession({ manifest, rootKey });
  }

  private async openSession(
    manifest: LocalKeyringManifest,
  ): Promise<LocalKeyringSession> {
    assertLocalKeyringManifest(manifest);
    const rootKey = await this.options.keystore.unwrapSecret({
      context: localSecretContext(manifest.scope, "account-root"),
      envelope: manifest.rootKeyEnvelope,
    });

    return createLocalKeyringSession({ manifest, rootKey });
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
