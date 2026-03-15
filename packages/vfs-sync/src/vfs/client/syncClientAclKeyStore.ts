/**
 * Trust-on-first-use (TOFU) key store for client-side ACL signature
 * verification. Pins an actor's public signing key on first encounter
 * and raises an error if a subsequent operation arrives with a different key.
 */

export interface VfsAclKeyStoreEntry {
  publicSigningKey: string;
  firstSeenAt: string;
}

export class VfsAclTofuKeyStore {
  private readonly keys = new Map<string, VfsAclKeyStoreEntry>();

  /**
   * Pin or verify an actor's public signing key.
   *
   * @returns `true` if the key matches (or was pinned for the first time).
   *          `false` if the key conflicts with a previously pinned key.
   */
  verifyOrPin(actorId: string, publicSigningKey: string): boolean {
    const existing = this.keys.get(actorId);
    if (!existing) {
      this.keys.set(actorId, {
        publicSigningKey,
        firstSeenAt: new Date().toISOString()
      });
      return true;
    }

    return existing.publicSigningKey === publicSigningKey;
  }

  get(actorId: string): VfsAclKeyStoreEntry | null {
    return this.keys.get(actorId) ?? null;
  }

  clear(): void {
    this.keys.clear();
  }
}
