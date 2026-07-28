/**
 * Bounded cache exposing the subset of the `Map` surface the request helpers
 * in `requestInternals` rely on (`get`, `has`, `set`, `delete`, `clear`). The
 * persistent request caches in `ApiClient` retain one entry per unique
 * container/document/user id read for the lifetime of the client; without a
 * bound a long-lived client accumulates unbounded entries.
 *
 * Eviction is by insertion recency: (re)writing an entry marks it newest, and
 * inserting past `maxEntries` evicts the oldest-written entry. Crucially `get`
 * is SIDE-EFFECT-FREE — it does not re-order — because the request helpers
 * compare the stored promise by reference (`cache.get(key) === pending`) to
 * decide whether to invalidate it; a read that mutated ordering would make
 * eviction timing depend on read interleaving and could surprise those guards.
 * This is deliberately a freshness/coalescing cache, not a correctness
 * boundary: entries are still invalidated explicitly on mutation and auth
 * change, and a returned promise is held by its awaiter, so an evicted entry
 * at worst costs a missed coalesce / re-fetch, never wrong data.
 */
export class BoundedCache<V> {
  private readonly entries = new Map<string, V>();
  private readonly maxEntries: number;
  private evictionCount = 0;

  constructor(maxEntries = 256) {
    if (maxEntries < 1) {
      throw new RangeError("BoundedCache maxEntries must be at least 1");
    }
    this.maxEntries = maxEntries;
  }

  get size(): number {
    return this.entries.size;
  }

  /**
   * Monotonic counter bumped by every explicit invalidation (`delete`,
   * including of an absent key, and `clear`). A fetch that snapshots it
   * before running and re-checks after can tell that an invalidation
   * happened mid-flight even when the slot was empty both times — the case
   * a slot-identity comparison alone cannot see. Deliberately NOT bumped by
   * `set` or by recency overflow: those are not invalidation signals, and
   * the counter is coarse (cache-wide) on purpose — a false positive only
   * skips warming the cache.
   */
  get evictionGeneration(): number {
    return this.evictionCount;
  }

  get(key: string): V | undefined {
    return this.entries.get(key);
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  set(key: string, value: V): this {
    // Delete first so an overwrite refreshes recency rather than keeping the
    // original insertion position.
    this.entries.delete(key);
    this.entries.set(key, value);
    this.evictOverflow();
    return this;
  }

  delete(key: string): boolean {
    // Bump even when the key is absent: an eviction of an empty slot still
    // expresses that whatever is in flight for the id is invalid.
    this.evictionCount += 1;
    return this.entries.delete(key);
  }

  clear(): void {
    this.evictionCount += 1;
    this.entries.clear();
  }

  private evictOverflow(): void {
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) {
        return;
      }
      this.entries.delete(oldest);
    }
  }
}
