import { describe, expect, it } from 'vitest';
import {
  calculateScaledDimensions,
  DEFAULT_THUMBNAIL_OPTIONS,
  isThumbnailSupported
} from './thumbnail';

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

  describe('calculateScaledDimensions', () => {
    it('returns original dimensions when smaller than max', () => {
      const result = calculateScaledDimensions(100, 80, 200, 200);
      expect(result).toEqual({ width: 100, height: 80 });
    });

    it('returns original dimensions when equal to max', () => {
      const result = calculateScaledDimensions(200, 200, 200, 200);
      expect(result).toEqual({ width: 200, height: 200 });
    });

    it('scales down landscape image to fit width', () => {
      const result = calculateScaledDimensions(400, 200, 200, 200);
      expect(result).toEqual({ width: 200, height: 100 });
    });

    it('scales down portrait image to fit height', () => {
      const result = calculateScaledDimensions(200, 400, 200, 200);
      expect(result).toEqual({ width: 100, height: 200 });
    });

    it('scales down square image proportionally', () => {
      const result = calculateScaledDimensions(400, 400, 200, 200);
      expect(result).toEqual({ width: 200, height: 200 });
    });

    it('handles non-square max dimensions with landscape image', () => {
      const result = calculateScaledDimensions(800, 400, 200, 100);
      // Width ratio: 200/800 = 0.25, Height ratio: 100/400 = 0.25
      expect(result).toEqual({ width: 200, height: 100 });
    });

    it('handles non-square max dimensions with portrait image', () => {
      const result = calculateScaledDimensions(400, 800, 100, 200);
      // Width ratio: 100/400 = 0.25, Height ratio: 200/800 = 0.25
      expect(result).toEqual({ width: 100, height: 200 });
    });

    it('scales down using smaller ratio when aspect ratios differ', () => {
      // 1000x500 image into 200x200 max
      // Width ratio: 200/1000 = 0.2, Height ratio: 200/500 = 0.4
      // Uses 0.2, resulting in 200x100
      const result = calculateScaledDimensions(1000, 500, 200, 200);
      expect(result).toEqual({ width: 200, height: 100 });
    });

    it('preserves aspect ratio for tall narrow image', () => {
      // 100x1000 into 200x200
      // Width ratio: 200/100 = 2.0 (would scale up), Height ratio: 200/1000 = 0.2
      // Uses 0.2, resulting in 20x200
      const result = calculateScaledDimensions(100, 1000, 200, 200);
      expect(result).toEqual({ width: 20, height: 200 });
    });

    it('rounds dimensions to integers', () => {
      // 333x333 into 200x200 -> scale = 0.6006...
      // Result would be 199.98... x 199.98... -> rounds to 200x200
      const result = calculateScaledDimensions(333, 333, 200, 200);
      expect(result.width).toBe(200);
      expect(result.height).toBe(200);
    });
  });
});
