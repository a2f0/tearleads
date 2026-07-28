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
  private readonly invalidationStampsByKey = new Map<string, number>();
  private readonly maxEntries: number;
  private invalidationTick = 0;
  private prunedInvalidationFloor = 0;

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
   * Monotonic stamp of the key's most recent explicit invalidation (`delete`,
   * including of an absent key, or `clear`). A fetch that snapshots it before
   * running and re-checks after can tell that an invalidation of ITS key
   * happened mid-flight even when the slot was empty both times — the case a
   * slot-identity comparison alone cannot see — while invalidations of other
   * keys leave the stamp alone, so they never break unrelated coalescing.
   * Deliberately unaffected by `set` and by recency overflow: those are not
   * invalidation signals. Stamp bookkeeping is bounded; pruned stamps fold
   * into a shared floor, which can only over-invalidate (skip a cache warm or
   * a coalesce), never under-invalidate.
   */
  invalidationStamp(key: string): number {
    return Math.max(
      this.invalidationStampsByKey.get(key) ?? 0,
      this.prunedInvalidationFloor,
    );
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
    // Stamp even when the key is absent: an eviction of an empty slot still
    // expresses that whatever is in flight for the id is invalid. Re-insert
    // so the newest stamp sits last and pruning drops the oldest first.
    this.invalidationTick += 1;
    this.invalidationStampsByKey.delete(key);
    this.invalidationStampsByKey.set(key, this.invalidationTick);
    this.pruneInvalidationStamps();
    return this.entries.delete(key);
  }

  clear(): void {
    this.invalidationTick += 1;
    this.prunedInvalidationFloor = this.invalidationTick;
    this.invalidationStampsByKey.clear();
    this.entries.clear();
  }

  private pruneInvalidationStamps(): void {
    while (this.invalidationStampsByKey.size > this.maxEntries) {
      const oldest = this.invalidationStampsByKey.entries().next().value;
      if (oldest === undefined) {
        return;
      }
      this.invalidationStampsByKey.delete(oldest[0]);
      this.prunedInvalidationFloor = Math.max(
        this.prunedInvalidationFloor,
        oldest[1],
      );
    }
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
