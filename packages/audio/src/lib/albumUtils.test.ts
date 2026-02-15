import { describe, expect, it } from 'vitest';
import {
  ALL_ALBUMS_ID,
  createAlbumId,
  isValidAlbumId,
  parseAlbumId
} from './albumUtils';

describe('albumUtils', () => {
  describe('createAlbumId', () => {
    it('creates a deterministic ID from album name', () => {
      const id1 = createAlbumId('Abbey Road');
      const id2 = createAlbumId('Abbey Road');
      expect(id1).toBe(id2);
    });

    it('creates a deterministic ID from album name and artist', () => {
      const id1 = createAlbumId('Abbey Road', 'The Beatles');
      const id2 = createAlbumId('Abbey Road', 'The Beatles');
      expect(id1).toBe(id2);
    });

    it('creates different IDs for different albums', () => {
      const id1 = createAlbumId('Abbey Road');
      const id2 = createAlbumId('Let It Be');
      expect(id1).not.toBe(id2);
    });

    it('creates different IDs for same album name but different artist', () => {
      const id1 = createAlbumId('Greatest Hits', 'Artist A');
      const id2 = createAlbumId('Greatest Hits', 'Artist B');
      expect(id1).not.toBe(id2);
    });

    it('handles null artist', () => {
      const id1 = createAlbumId('Album', null);
      const id2 = createAlbumId('Album');
      expect(id1).toBe(id2);
    });

    it('handles empty artist', () => {
      const id1 = createAlbumId('Album', '');
      const id2 = createAlbumId('Album', null);
      expect(id1).toBe(id2);
    });

    it('handles special characters in album name', () => {
      const id = createAlbumId("What's Going On?", 'Marvin Gaye');
      expect(id).toBeDefined();
      expect(typeof id).toBe('string');
    });

    it('handles unicode characters', () => {
      const id = createAlbumId('日本語アルバム', 'アーティスト');
      expect(id).toBeDefined();
      const parsed = parseAlbumId(id);
      expect(parsed).toEqual({
        name: '日本語アルバム',
        artist: 'アーティスト'
      });
    });
  });

  describe('parseAlbumId', () => {
    it('parses a valid album ID with artist', () => {
      const id = createAlbumId('Abbey Road', 'The Beatles');
      const parsed = parseAlbumId(id);
      expect(parsed).toEqual({
        name: 'Abbey Road',
        artist: 'The Beatles'
      });
    });

    it('parses a valid album ID without artist', () => {
      const id = createAlbumId('Unknown Album');
      const parsed = parseAlbumId(id);
      expect(parsed).toEqual({
        name: 'Unknown Album',
        artist: null
      });
    });

    it('returns null for invalid base64', () => {
      const parsed = parseAlbumId('not-valid-base64!!!');
      expect(parsed).toBeNull();
    });

    it('returns null for valid base64 but invalid format', () => {
      const invalidId = btoa('some random string');
      const parsed = parseAlbumId(invalidId);
      expect(parsed).toBeNull();
    });

    it('returns null for empty string', () => {
      const parsed = parseAlbumId('');
      expect(parsed).toBeNull();
    });
  });

  describe('isValidAlbumId', () => {
    it('returns true for valid album ID', () => {
      const id = createAlbumId('Test Album', 'Test Artist');
      expect(isValidAlbumId(id)).toBe(true);
    });

    it('returns false for invalid album ID', () => {
      expect(isValidAlbumId('invalid')).toBe(false);
      expect(isValidAlbumId('')).toBe(false);
      expect(isValidAlbumId('abc123')).toBe(false);
    });

    it('returns false for ALL_ALBUMS_ID', () => {
      expect(isValidAlbumId(ALL_ALBUMS_ID)).toBe(false);
    });
  });

  describe('ALL_ALBUMS_ID', () => {
    it('is a defined constant', () => {
      expect(ALL_ALBUMS_ID).toBe('all-albums');
    });
  });

  describe('roundtrip', () => {
    it('can create and parse album IDs', () => {
      const testCases = [
        { name: 'Simple Album', artist: 'Simple Artist' },
        { name: 'Album with spaces', artist: 'Artist with spaces' },
        { name: 'Special!@#$%', artist: 'Chars&*()' },
        { name: 'No Artist Album', artist: null },
        { name: '', artist: '' }
      ];

      for (const { name, artist } of testCases) {
        const id = createAlbumId(name, artist);
        const parsed = parseAlbumId(id);
        expect(parsed).not.toBeNull();
        expect(parsed?.name).toBe(name);
        expect(parsed?.artist).toBe(artist || null);
      }
    });
  });
});
