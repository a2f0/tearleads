import { describe, expect, it } from 'vitest';
import { InMemoryVfsBlobObjectStore } from './sync-blob-object-store.js';

describe('InMemoryVfsBlobObjectStore', () => {
  it('tracks registered blobs deterministically', () => {
    const store = new InMemoryVfsBlobObjectStore();

    expect(store.registerBlob('blob-b')).toBe(true);
    expect(store.registerBlob('blob-a')).toBe(true);
    expect(store.registerBlob('blob-a')).toBe(false);
    expect(store.snapshot()).toEqual(['blob-a', 'blob-b']);
  });

  it('ignores invalid identifiers and supports removal', () => {
    const store = new InMemoryVfsBlobObjectStore();

    expect(store.registerBlob('')).toBe(false);
    expect(store.registerBlob('blob-1')).toBe(true);
    expect(store.hasBlob('blob-1')).toBe(true);
    expect(store.removeBlob('blob-1')).toBe(true);
    expect(store.hasBlob('blob-1')).toBe(false);
    expect(store.removeBlob('blob-1')).toBe(false);
  });
});
