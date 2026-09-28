import { sha256Hex } from "./sha256";
import { StoredVerificationCache } from "./storedVerificationCache";

/**
 * Requested heads outlive intermediate-history cache churn. Concurrent readers
 * wait for the same immutable source, then reuse only a successful verified
 * result. Failures are retried in each caller's own database snapshot.
 */
export class StoredManifestWork<T> {
  private readonly heads: StoredVerificationCache<T>;
  private pending = new Map<string, Promise<T>>();
  private generation = 0;

  constructor(maxHeads: number) {
    this.heads = new StoredVerificationCache(maxHeads);
  }

  get(key: string, source: unknown): T | undefined {
    return this.heads.get(key, this.fingerprint(source));
  }

  async run(input: {
    readonly key: string;
    readonly source: unknown;
    readonly verify: () => Promise<T>;
  }): Promise<T> {
    // Capture before awaiting: a caller editing its source while verification
    // runs must never bind the old result to the edited source's fingerprint.
    const fingerprint = this.fingerprint(input.source);
    const cached = this.heads.get(input.key, fingerprint);
    if (cached !== undefined) return cached;
    const pending = this.pending;
    const pendingKey = JSON.stringify([input.key, fingerprint]);
    const existing = pending.get(pendingKey);
    if (existing) {
      try {
        await existing;
      } catch {
        // A different transaction may lack dependencies visible to this one.
        // Its failure is not evidence about this caller's stored history.
      }
      // Recheck the source and cache after waiting, including an intervening
      // clear or eviction. Never return an unretained result from old work.
      return this.run(input);
    }
    const generation = this.generation;
    const result = Promise.resolve()
      .then(input.verify)
      .then((value) => {
        if (
          generation === this.generation &&
          this.fingerprint(input.source) === fingerprint
        )
          this.heads.set(input.key, fingerprint, value);
        return value;
      })
      .finally(() => pending.delete(pendingKey));
    pending.set(pendingKey, result);
    return result;
  }

  clear(): void {
    this.generation += 1;
    this.heads.clear();
    this.pending = new Map();
  }

  private fingerprint(source: unknown): string {
    return sha256Hex(JSON.stringify(source) ?? "undefined");
  }
}
