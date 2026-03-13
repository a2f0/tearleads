/**
 * Simple Bloom Filter implementation for probabilistic set membership checks.
 * Used to optimize sync by identifying missing operations without full transfers.
 */

/**
 * Fast 32-bit FNV-1a hash implementation.
 */
function fnv1a(data: Uint8Array, seed = 0x811c9dc5): number {
  let hash = seed;
  for (let i = 0; i < data.length; i++) {
    const byte = data[i];
    hash ^= byte ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export interface VfsBloomFilterOptions {
  /** Expected number of elements */
  capacity: number;
  /** False positive probability (e.g. 0.01 for 1%) */
  errorRate: number;
}

export class VfsBloomFilter {
  private readonly bitArray: Uint8Array;
  private readonly numHashFunctions: number;
  private readonly size: number;

  constructor(options: VfsBloomFilterOptions) {
    const { capacity, errorRate } = options;
    // Optimal size m = -(n * ln(p)) / (ln(2)^2)
    this.size = Math.ceil(-(capacity * Math.log(errorRate)) / Math.log(2) ** 2);
    // Optimal hash functions k = (m/n) * ln(2)
    this.numHashFunctions = Math.max(
      1,
      Math.round((this.size / capacity) * Math.log(2))
    );

    this.bitArray = new Uint8Array(Math.ceil(this.size / 8));
  }

  /**
   * Adds a value to the bloom filter.
   */
  add(value: string | Uint8Array): void {
    const data =
      typeof value === 'string' ? new TextEncoder().encode(value) : value;
    for (let i = 0; i < this.numHashFunctions; i++) {
      const hash = fnv1a(data, i); // Use 'i' as a seed for different hash functions
      const index = hash % this.size;
      this.setBit(index);
    }
  }

  /**
   * Checks if a value might be in the set.
   * Returns true if it might be present, false if it is definitely not.
   */
  has(value: string | Uint8Array): boolean {
    const data =
      typeof value === 'string' ? new TextEncoder().encode(value) : value;
    for (let i = 0; i < this.numHashFunctions; i++) {
      const hash = fnv1a(data, i);
      const index = hash % this.size;
      if (!this.getBit(index)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Returns the raw bit array.
   */
  toUint8Array(): Uint8Array {
    return this.bitArray;
  }

  /**
   * Creates a filter from a raw bit array and original configuration.
   */
  static fromUint8Array(
    data: Uint8Array,
    options: VfsBloomFilterOptions
  ): VfsBloomFilter {
    const filter = new VfsBloomFilter(options);
    if (data.length !== filter.bitArray.length) {
      throw new Error('Mismatched bit array length for bloom filter');
    }
    filter.bitArray.set(data);
    return filter;
  }

  private setBit(index: number): void {
    const byteIndex = Math.floor(index / 8);
    const bitIndex = index % 8;
    const current = this.bitArray[byteIndex] ?? 0;
    this.bitArray[byteIndex] = current | (1 << bitIndex);
  }

  private getBit(index: number): boolean {
    const byteIndex = Math.floor(index / 8);
    const bitIndex = index % 8;
    const current = this.bitArray[byteIndex] ?? 0;
    return (current & (1 << bitIndex)) !== 0;
  }
}
