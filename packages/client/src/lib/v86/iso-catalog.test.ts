import { describe, expect, it } from 'vitest';
import { ISO_CATALOG } from './iso-catalog';

describe('iso-catalog', () => {
  it('exports ISO_CATALOG array', () => {
    expect(Array.isArray(ISO_CATALOG)).toBe(true);
  });

  it('each entry has required fields', () => {
    for (const entry of ISO_CATALOG) {
      expect(typeof entry.id).toBe('string');
      expect(typeof entry.name).toBe('string');
      expect(typeof entry.description).toBe('string');
      expect(typeof entry.downloadUrl).toBe('string');
      expect(typeof entry.sizeBytes).toBe('number');
      expect(['cdrom', 'hda']).toContain(entry.bootType);
      expect(typeof entry.memoryMb).toBe('number');
    }
  });

  it('all entries have unique IDs', () => {
    const ids = ISO_CATALOG.map((entry) => entry.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('all download URLs are valid HTTPS URLs', () => {
    for (const entry of ISO_CATALOG) {
      expect(entry.downloadUrl.startsWith('https://')).toBe(true);
    }
  });

  it('all entries have positive memory requirements', () => {
    for (const entry of ISO_CATALOG) {
      expect(entry.memoryMb).toBeGreaterThan(0);
    }
  });

  it('all entries have positive file sizes', () => {
    for (const entry of ISO_CATALOG) {
      expect(entry.sizeBytes).toBeGreaterThan(0);
    }
  });
});
