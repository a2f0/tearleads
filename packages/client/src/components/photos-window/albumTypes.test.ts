import { describe, expect, it } from 'vitest';
import {
  canDeleteAlbum,
  canRenameAlbum,
  isSystemAlbum,
  type PhotoAlbum,
  SYSTEM_ALBUM_NAMES,
  SYSTEM_ALBUM_TYPES
} from './albumTypes';

const makeAlbum = (overrides: Partial<PhotoAlbum> = {}): PhotoAlbum => ({
  id: 'test-id',
  name: 'Test Album',
  photoCount: 0,
  coverPhotoId: null,
  albumType: 'custom',
  ...overrides
});

describe('albumTypes', () => {
  describe('SYSTEM_ALBUM_TYPES', () => {
    it('includes photoroll', () => {
      expect(SYSTEM_ALBUM_TYPES).toContain('photoroll');
    });
  });

  describe('SYSTEM_ALBUM_NAMES', () => {
    it('has a name for photoroll', () => {
      expect(SYSTEM_ALBUM_NAMES.photoroll).toBe('Photo Roll');
    });
  });

  describe('isSystemAlbum', () => {
    it('returns true for photoroll album', () => {
      const album = makeAlbum({ albumType: 'photoroll' });
      expect(isSystemAlbum(album)).toBe(true);
    });

    it('returns false for custom album', () => {
      const album = makeAlbum({ albumType: 'custom' });
      expect(isSystemAlbum(album)).toBe(false);
    });
  });

  describe('canDeleteAlbum', () => {
    it('returns true for custom album', () => {
      const album = makeAlbum({ albumType: 'custom' });
      expect(canDeleteAlbum(album)).toBe(true);
    });

    it('returns false for photoroll album', () => {
      const album = makeAlbum({ albumType: 'photoroll' });
      expect(canDeleteAlbum(album)).toBe(false);
    });
  });

  describe('canRenameAlbum', () => {
    it('returns true for custom album', () => {
      const album = makeAlbum({ albumType: 'custom' });
      expect(canRenameAlbum(album)).toBe(true);
    });

    it('returns false for photoroll album', () => {
      const album = makeAlbum({ albumType: 'photoroll' });
      expect(canRenameAlbum(album)).toBe(false);
    });
  });
});
