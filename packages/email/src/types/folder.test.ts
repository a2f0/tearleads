import { describe, expect, it } from 'vitest';
import {
  ALL_MAIL_ID,
  canDeleteFolder,
  canHaveChildren,
  canRenameFolder,
  type EmailFolder,
  isSystemFolder,
  SYSTEM_FOLDER_NAMES,
  SYSTEM_FOLDER_TYPES
} from './folder.js';

describe('folder types', () => {
  describe('constants', () => {
    it('exports ALL_MAIL_ID', () => {
      expect(ALL_MAIL_ID).toBe('__all_mail__');
    });

    it('exports SYSTEM_FOLDER_TYPES', () => {
      expect(SYSTEM_FOLDER_TYPES).toEqual([
        'inbox',
        'sent',
        'drafts',
        'trash',
        'spam'
      ]);
    });

    it('exports SYSTEM_FOLDER_NAMES', () => {
      expect(SYSTEM_FOLDER_NAMES).toEqual({
        inbox: 'Inbox',
        sent: 'Sent',
        drafts: 'Drafts',
        trash: 'Trash',
        spam: 'Spam'
      });
    });
  });

  describe('isSystemFolder', () => {
    it('returns true for inbox folder', () => {
      const folder: EmailFolder = {
        id: '1',
        name: 'Inbox',
        folderType: 'inbox',
        parentId: null,
        unreadCount: 0
      };
      expect(isSystemFolder(folder)).toBe(true);
    });

    it('returns true for sent folder', () => {
      const folder: EmailFolder = {
        id: '2',
        name: 'Sent',
        folderType: 'sent',
        parentId: null,
        unreadCount: 0
      };
      expect(isSystemFolder(folder)).toBe(true);
    });

    it('returns true for drafts folder', () => {
      const folder: EmailFolder = {
        id: '3',
        name: 'Drafts',
        folderType: 'drafts',
        parentId: null,
        unreadCount: 0
      };
      expect(isSystemFolder(folder)).toBe(true);
    });

    it('returns true for trash folder', () => {
      const folder: EmailFolder = {
        id: '4',
        name: 'Trash',
        folderType: 'trash',
        parentId: null,
        unreadCount: 0
      };
      expect(isSystemFolder(folder)).toBe(true);
    });

    it('returns true for spam folder', () => {
      const folder: EmailFolder = {
        id: '5',
        name: 'Spam',
        folderType: 'spam',
        parentId: null,
        unreadCount: 0
      };
      expect(isSystemFolder(folder)).toBe(true);
    });

    it('returns false for custom folder', () => {
      const folder: EmailFolder = {
        id: '6',
        name: 'My Folder',
        folderType: 'custom',
        parentId: null,
        unreadCount: 0
      };
      expect(isSystemFolder(folder)).toBe(false);
    });
  });

  describe('canRenameFolder', () => {
    it('returns false for system folder', () => {
      const folder: EmailFolder = {
        id: '1',
        name: 'Inbox',
        folderType: 'inbox',
        parentId: null,
        unreadCount: 0
      };
      expect(canRenameFolder(folder)).toBe(false);
    });

    it('returns true for custom folder', () => {
      const folder: EmailFolder = {
        id: '6',
        name: 'My Folder',
        folderType: 'custom',
        parentId: null,
        unreadCount: 0
      };
      expect(canRenameFolder(folder)).toBe(true);
    });
  });

  describe('canDeleteFolder', () => {
    it('returns false for system folder', () => {
      const folder: EmailFolder = {
        id: '1',
        name: 'Inbox',
        folderType: 'inbox',
        parentId: null,
        unreadCount: 0
      };
      expect(canDeleteFolder(folder)).toBe(false);
    });

    it('returns true for custom folder', () => {
      const folder: EmailFolder = {
        id: '6',
        name: 'My Folder',
        folderType: 'custom',
        parentId: null,
        unreadCount: 0
      };
      expect(canDeleteFolder(folder)).toBe(true);
    });
  });

  describe('canHaveChildren', () => {
    it('returns true for custom folder', () => {
      const folder: EmailFolder = {
        id: '6',
        name: 'My Folder',
        folderType: 'custom',
        parentId: null,
        unreadCount: 0
      };
      expect(canHaveChildren(folder)).toBe(true);
    });

    it('returns false for system folders', () => {
      const systemTypes = ['inbox', 'sent', 'drafts', 'trash', 'spam'] as const;

      for (const folderType of systemTypes) {
        const folder: EmailFolder = {
          id: '1',
          name: 'Test',
          folderType,
          parentId: null,
          unreadCount: 0
        };
        expect(canHaveChildren(folder)).toBe(false);
      }
    });
  });
});
