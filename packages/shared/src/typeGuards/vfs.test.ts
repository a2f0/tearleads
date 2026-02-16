import { describe, expect, it } from 'vitest';
import { isVfsSharedByMeQueryRow, isVfsSharedWithMeQueryRow } from './vfs.js';

describe('VFS Type Guards', () => {
  const validByMeRow = {
    id: 'item-1',
    objectType: 'file',
    name: 'test.txt',
    createdAt: new Date(),
    shareId: 'share-1',
    targetId: 'user-2',
    targetName: 'User Two',
    shareType: 'user',
    permissionLevel: 'view',
    sharedAt: new Date(),
    expiresAt: null
  };

  const validWithMeRow = {
    id: 'item-1',
    objectType: 'file',
    name: 'test.txt',
    createdAt: new Date(),
    shareId: 'share-1',
    sharedById: 'user-1',
    sharedByEmail: 'user1@example.com',
    shareType: 'user',
    permissionLevel: 'view',
    sharedAt: new Date(),
    expiresAt: new Date()
  };

  describe('isVfsSharedByMeQueryRow', () => {
    it('returns true for a valid row', () => {
      expect(isVfsSharedByMeQueryRow(validByMeRow)).toBe(true);
    });

    it('returns false for non-objects', () => {
      expect(isVfsSharedByMeQueryRow(null)).toBe(false);
      expect(isVfsSharedByMeQueryRow('string')).toBe(false);
    });

    it('returns false if a required field is missing', () => {
      const { id, ...invalidRow } = validByMeRow;
      expect(isVfsSharedByMeQueryRow(invalidRow)).toBe(false);
    });

    it('returns false if a field has the wrong type', () => {
      expect(isVfsSharedByMeQueryRow({ ...validByMeRow, id: 123 })).toBe(false);
      expect(
        isVfsSharedByMeQueryRow({ ...validByMeRow, createdAt: '2024-01-01' })
      ).toBe(false);
    });
  });

  describe('isVfsSharedWithMeQueryRow', () => {
    it('returns true for a valid row', () => {
      expect(isVfsSharedWithMeQueryRow(validWithMeRow)).toBe(true);
    });

    it('returns false for non-objects', () => {
      expect(isVfsSharedWithMeQueryRow(null)).toBe(false);
    });

    it('returns false if a required field is missing', () => {
      const { sharedByEmail, ...invalidRow } = validWithMeRow;
      expect(isVfsSharedWithMeQueryRow(invalidRow)).toBe(false);
    });

    it('returns false if a field has the wrong type', () => {
      expect(
        isVfsSharedWithMeQueryRow({ ...validWithMeRow, shareType: 1 })
      ).toBe(false);
    });
  });
});
