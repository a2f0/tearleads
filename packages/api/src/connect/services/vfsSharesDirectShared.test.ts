import { describe, expect, it } from 'vitest';
import {
  buildOrgShareAclId,
  buildShareAclId,
  extractOrgShareIdFromAclId,
  extractShareIdFromAclId,
  isValidShareType,
  parseCreateOrgSharePayload,
  parseCreateSharePayload,
  parseUpdateSharePayload
} from './vfsSharesDirectShared.js';

describe('vfsSharesDirectShared', () => {
  describe('ID helpers', () => {
    it('buildShareAclId returns the ID as-is', () => {
      expect(buildShareAclId('abc')).toBe('abc');
    });

    it('buildOrgShareAclId returns the shareId as-is', () => {
      expect(buildOrgShareAclId('org-1', 'share-1')).toBe('share-1');
    });

    it('extractShareIdFromAclId returns the ID as-is', () => {
      expect(extractShareIdFromAclId('abc')).toBe('abc');
    });

    it('extractOrgShareIdFromAclId returns the ID as-is', () => {
      expect(extractOrgShareIdFromAclId('abc')).toBe('abc');
    });
  });

  describe('isValidShareType', () => {
    it('returns true for valid types', () => {
      expect(isValidShareType('user')).toBe(true);
      expect(isValidShareType('group')).toBe(true);
      expect(isValidShareType('organization')).toBe(true);
    });

    it('returns false for invalid types', () => {
      expect(isValidShareType('role')).toBe(false);
      expect(isValidShareType(null)).toBe(false);
      expect(isValidShareType('')).toBe(false);
    });
  });

  describe('parseCreateSharePayload', () => {
    it('returns parsed payload for valid input', () => {
      const body = {
        itemId: 'item-1',
        shareType: 'user',
        targetId: 'user-1',
        permissionLevel: 'view',
        expiresAt: '2026-12-31T23:59:59Z'
      };
      expect(parseCreateSharePayload(body)).toEqual({
        itemId: 'item-1',
        shareType: 'user',
        targetId: 'user-1',
        permissionLevel: 'view',
        expiresAt: '2026-12-31T23:59:59Z',
        wrappedKey: null
      });
    });

    it('returns null for missing required fields', () => {
      expect(parseCreateSharePayload({ itemId: 'item-1' })).toBeNull();
    });

    it('returns null for invalid types', () => {
      expect(
        parseCreateSharePayload({
          itemId: 'item-1',
          shareType: 'unknown',
          targetId: 'user-1',
          permissionLevel: 'view'
        })
      ).toBeNull();
    });
  });

  describe('parseCreateOrgSharePayload', () => {
    it('returns parsed payload for valid input', () => {
      const body = {
        itemId: 'item-1',
        sourceOrgId: 'org-1',
        targetOrgId: 'org-2',
        permissionLevel: 'edit'
      };
      expect(parseCreateOrgSharePayload(body)).toEqual({
        itemId: 'item-1',
        sourceOrgId: 'org-1',
        targetOrgId: 'org-2',
        permissionLevel: 'edit',
        expiresAt: null,
        wrappedKey: null
      });
    });
  });

  describe('parseUpdateSharePayload', () => {
    it('returns parsed payload for valid updates', () => {
      const body = { permissionLevel: 'edit' };
      expect(parseUpdateSharePayload(body)).toEqual({
        permissionLevel: 'edit'
      });
    });

    it('returns empty object for empty body', () => {
      expect(parseUpdateSharePayload({})).toEqual({});
    });

    it('returns null for invalid permissionLevel', () => {
      expect(parseUpdateSharePayload({ permissionLevel: 'owner' })).toBeNull();
    });
  });
});
