interface CacheEntry<T> {
  readonly size: number;
  readonly value: T;
}

/** LRU bounded by a conservative retained-byte estimate, including entry keys. */
export class ByteBudgetCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  private retainedBytes = 0;

  constructor(private readonly maxBytes: number) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
      throw new RangeError("Cache byte budget must be a positive integer");
  }

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, valueBytes: number): void {
    if (!Number.isSafeInteger(valueBytes) || valueBytes < 0)
      throw new RangeError("Cache entry size must be a nonnegative integer");
    this.remove(key);
    // Charge UTF-16 key storage and fixed Map/entry overhead even for empty values.
    const size = valueBytes + key.length * 2 + 128;
    if (size > this.maxBytes) return;
    while (this.retainedBytes + size > this.maxBytes) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.remove(oldest);
    }
    this.entries.set(key, { value, size });
    this.retainedBytes += size;
  }

  clear(): void {
    this.entries.clear();
    this.retainedBytes = 0;
  }

  private remove(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.retainedBytes -= entry.size;
    this.entries.delete(key);
  }
}
