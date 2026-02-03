import { describe, expect, it } from 'vitest';

import {
  compress,
  compressString,
  decompress,
  decompressString
} from './compression';

describe('compression', () => {
  describe('compress and decompress', () => {
    it('compresses and decompresses data correctly', async () => {
      const original = new TextEncoder().encode('Hello, World!');
      const compressed = await compress(original);
      const decompressed = await decompress(compressed);

      expect(Array.from(decompressed)).toEqual(Array.from(original));
    });

    it('produces smaller output for compressible data', async () => {
      // Highly compressible: repeated pattern
      const original = new Uint8Array(10000);
      original.fill(65); // 'A' repeated 10000 times

      const compressed = await compress(original);

      expect(compressed.length).toBeLessThan(original.length);
    });

    it('handles empty data', async () => {
      const original = new Uint8Array(0);
      const compressed = await compress(original);
      const decompressed = await decompress(compressed);

      expect(decompressed.length).toBe(0);
    });

    it('handles single byte', async () => {
      const original = new Uint8Array([42]);
      const compressed = await compress(original);
      const decompressed = await decompress(compressed);

      expect(Array.from(decompressed)).toEqual([42]);
    });

    it('handles binary data with all byte values', async () => {
      const original = new Uint8Array(256);
      for (let i = 0; i < 256; i++) {
        original[i] = i;
      }

      const compressed = await compress(original);
      const decompressed = await decompress(compressed);

      expect(Array.from(decompressed)).toEqual(Array.from(original));
    });

    it('handles large data', async () => {
      // 1 MB of random-ish data (less compressible)
      const original = new Uint8Array(1024 * 1024);
      for (let i = 0; i < original.length; i++) {
        original[i] = (i * 17 + 31) % 256;
      }

      const compressed = await compress(original);
      const decompressed = await decompress(compressed);

      expect(Array.from(decompressed)).toEqual(Array.from(original));
    });

    it('handles JSON-like data', async () => {
      const json = JSON.stringify({
        users: Array.from({ length: 100 }, (_, i) => ({
          id: i,
          name: `User ${i}`,
          email: `user${i}@example.com`,
          active: i % 2 === 0
        }))
      });
      const original = new TextEncoder().encode(json);

      const compressed = await compress(original);
      const decompressed = await decompress(compressed);

      // JSON should be highly compressible due to repeated keys
      expect(compressed.length).toBeLessThan(original.length);
      expect(Array.from(decompressed)).toEqual(Array.from(original));
    });

    it('compressed output starts with gzip magic bytes', async () => {
      const original = new TextEncoder().encode('test data');
      const compressed = await compress(original);

      // Gzip magic bytes: 0x1f 0x8b
      expect(compressed[0]).toBe(0x1f);
      expect(compressed[1]).toBe(0x8b);
    });
  });

  describe('compressString and decompressString', () => {
    it('compresses and decompresses a string correctly', async () => {
      const original = 'Hello, World!';
      const compressed = await compressString(original);
      const decompressed = await decompressString(compressed);

      expect(decompressed).toBe(original);
    });

    it('handles empty string', async () => {
      const original = '';
      const compressed = await compressString(original);
      const decompressed = await decompressString(compressed);

      expect(decompressed).toBe(original);
    });

    it('handles unicode strings', async () => {
      const original = '你好世界 🌍 مرحبا العالم שלום עולם';
      const compressed = await compressString(original);
      const decompressed = await decompressString(compressed);

      expect(decompressed).toBe(original);
    });

    it('handles long strings', async () => {
      const original = 'a'.repeat(100000);
      const compressed = await compressString(original);
      const decompressed = await decompressString(compressed);

      expect(decompressed).toBe(original);
      // Repeated character should compress very well
      expect(compressed.length).toBeLessThan(1000);
    });

    it('handles multiline strings', async () => {
      const original = `Line 1
Line 2
Line 3
This is a longer line with more content.
And another line.`;
      const compressed = await compressString(original);
      const decompressed = await decompressString(compressed);

      expect(decompressed).toBe(original);
    });

    it('handles JSON strings', async () => {
      const original = JSON.stringify({
        name: 'Test',
        values: [1, 2, 3, 4, 5],
        nested: { a: 1, b: 2 }
      });
      const compressed = await compressString(original);
      const decompressed = await decompressString(compressed);

      expect(decompressed).toBe(original);
      expect(JSON.parse(decompressed)).toEqual(JSON.parse(original));
    });
  });

  describe('error handling', () => {
    it('throws on invalid compressed data', async () => {
      const invalidData = new Uint8Array([1, 2, 3, 4, 5]);

      await expect(decompress(invalidData)).rejects.toThrow();
    });

    it('throws on truncated compressed data', async () => {
      const original = new TextEncoder().encode('Hello, World!');
      const compressed = await compress(original);

      // Truncate the compressed data
      const truncated = compressed.slice(0, compressed.length - 5);

      await expect(decompress(truncated)).rejects.toThrow();
    });

    it('throws on corrupted compressed data', async () => {
      const original = new TextEncoder().encode('Hello, World!');
      const compressed = await compress(original);

      // Corrupt the data (but keep gzip header)
      const corrupted = new Uint8Array(compressed);
      if (corrupted.length > 10) {
        corrupted[10] = (corrupted[10] ?? 0) ^ 0xff;
      }

      await expect(decompress(corrupted)).rejects.toThrow();
    });
  });
});
