import { describe, expect, it } from 'vitest';
import { DEFAULT_THUMBNAIL_OPTIONS, isThumbnailSupported } from './thumbnail';

describe('thumbnail', () => {
  describe('isThumbnailSupported', () => {
    it('returns true for JPEG', () => {
      expect(isThumbnailSupported('image/jpeg')).toBe(true);
    });

    it('returns true for PNG', () => {
      expect(isThumbnailSupported('image/png')).toBe(true);
    });

    it('returns true for GIF', () => {
      expect(isThumbnailSupported('image/gif')).toBe(true);
    });

    it('returns true for WebP', () => {
      expect(isThumbnailSupported('image/webp')).toBe(true);
    });

    it('returns false for PDF', () => {
      expect(isThumbnailSupported('application/pdf')).toBe(false);
    });

    it('returns false for text files', () => {
      expect(isThumbnailSupported('text/plain')).toBe(false);
    });

    it('returns false for SVG', () => {
      expect(isThumbnailSupported('image/svg+xml')).toBe(false);
    });

    it('returns false for HEIC', () => {
      expect(isThumbnailSupported('image/heic')).toBe(false);
    });
  });

  describe('DEFAULT_THUMBNAIL_OPTIONS', () => {
    it('has expected default values', () => {
      expect(DEFAULT_THUMBNAIL_OPTIONS.maxWidth).toBe(200);
      expect(DEFAULT_THUMBNAIL_OPTIONS.maxHeight).toBe(200);
      expect(DEFAULT_THUMBNAIL_OPTIONS.quality).toBe(0.8);
    });
  });
});
