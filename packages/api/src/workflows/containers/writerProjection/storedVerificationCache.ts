import { sha256Hex } from "../../../utils/sha256";

interface StoredVerificationCacheEntry<T> {
  readonly fingerprint: string;
  readonly value: T;
}

/**
 * Bounded process cache for immutable, content-addressed verification results.
 * The source fingerprint prevents a row edited in place under the same claimed
 * hash from hitting an older verified value.
 */
export class StoredVerificationCache<T> {
  private readonly entries = new Map<string, StoredVerificationCacheEntry<T>>();

  constructor(private readonly maxEntries: number) {}

  get(key: string, source: unknown): T | undefined {
    const entry = this.entries.get(key);
    if (!entry || entry.fingerprint !== this.fingerprint(source)) {
      return;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, source: unknown, value: T): void {
    this.entries.delete(key);
    while (this.entries.size >= this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (typeof oldestKey !== "string") {
        break;
      }
      this.entries.delete(oldestKey);
    }
    this.entries.set(key, {
      fingerprint: this.fingerprint(source),
      value,
    });
  }

  private fingerprint(source: unknown): string {
    return sha256Hex(JSON.stringify(source) ?? "undefined");
  }
}
