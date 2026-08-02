import { unwrapAesGcmSecret, wrapAesGcmSecret } from "./aesGcmWrapping";
import { cloneManifest } from "./manifest";
import {
  localKeyringScopeKey,
  localWrappingKeyScopeHash,
  normalizeLocalKeyringScope,
} from "./scope";
import type {
  LocalKeyringManifest,
  LocalKeyringManifestStore,
  LocalKeyringScope,
  NormalizedLocalKeyringScope,
  UnwrapLocalSecretInput,
  WrapLocalSecretInput,
  WrappedLocalSecretEnvelope,
  WrappingKeyHandle,
  WrappingKeyKeystore,
} from "./types";

/**
 * Process-local keyring backends for tests and development wiring. Neither is a
 * durable or platform-secure keychain: everything they hold dies with the
 * process.
 */
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

async function memoryWrappingKeyId(
  scope: NormalizedLocalKeyringScope,
): Promise<string> {
  return `memory:${await localWrappingKeyScopeHash(scope)}`;
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
    return unwrapAesGcmSecret({
      context,
      envelope,
      provider: this.provider,
      resolveKey: (keyId) => this.keysById.get(keyId) ?? null,
    });
  }

  async wrapSecret({
    context,
    handle,
    plaintext,
  }: WrapLocalSecretInput): Promise<WrappedLocalSecretEnvelope> {
    return wrapAesGcmSecret({
      context,
      handle,
      plaintext,
      provider: this.provider,
      resolveKey: (keyId) => this.keysById.get(keyId) ?? null,
    });
  }
}

export function createMemoryLocalKeyringManifestStore(): LocalKeyringManifestStore {
  return new MemoryLocalKeyringManifestStore();
}

export function createMemoryWrappingKeyKeystore(): WrappingKeyKeystore {
  return new MemoryWrappingKeyKeystore();
}
