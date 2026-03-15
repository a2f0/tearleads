import { describe, expect, it } from 'vitest';
import { isValidSyncIdentifier } from './vfsSyncIdentifiers.js';

describe('isValidSyncIdentifier', () => {
  it('accepts lowercase UUIDs', () => {
    expect(isValidSyncIdentifier('00000000-0000-0000-0000-000000000001')).toBe(
      true
    );
    expect(isValidSyncIdentifier('a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBe(
      true
    );
  });

  it('accepts colon-separated opaque identifiers', () => {
    expect(isValidSyncIdentifier('source-1')).toBe(true);
    expect(isValidSyncIdentifier('vfs-item-state:abc123')).toBe(true);
    expect(isValidSyncIdentifier('actor-id:replica-id:123:op-id')).toBe(true);
  });

  it('rejects identifiers with underscores', () => {
    expect(isValidSyncIdentifier('vfs_item_state:abc123')).toBe(false);
  });

  it('rejects identifiers with uppercase letters', () => {
    expect(isValidSyncIdentifier('Source-1')).toBe(false);
  });

  it('rejects empty strings', () => {
    expect(isValidSyncIdentifier('')).toBe(false);
  });
});
