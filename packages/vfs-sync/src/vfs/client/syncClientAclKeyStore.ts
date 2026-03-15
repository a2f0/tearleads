/**
 * Trust-on-first-use (TOFU) key store for client-side ACL signature
 * verification. Pins an actor's public signing key on first encounter
 * and raises an error if a subsequent operation arrives with a different key.
 */

export class VfsAclTofuKeyStore {
  private readonly keys = new Map<string, string>();

  /**
   * Pin or verify an actor's public signing key.
   *
   * @returns `true` if the key matches (or was pinned for the first time).
   *          `false` if the key conflicts with a previously pinned key.
   */
  verifyOrPin(actorId: string, publicSigningKey: string): boolean {
    const existing = this.keys.get(actorId);
    if (!existing) {
      this.keys.set(actorId, publicSigningKey);
      return true;
    }

    return existing === publicSigningKey;
  }
}
