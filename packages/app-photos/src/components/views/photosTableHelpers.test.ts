import { describe, expect, it } from 'vitest';

import { getPhotoTypeDisplay } from './photosTableHelpers';

describe('getPhotoTypeDisplay', () => {
  it.each([
    ['image/jpeg', 'JPEG'],
    ['image/png', 'PNG'],
    ['image/gif', 'GIF'],
    ['image/webp', 'WebP'],
    ['image/heic', 'HEIC'],
    ['image/heif', 'HEIF'],
    ['image/svg+xml', 'SVG']
  ])('returns %s for %s', (mimeType, expected) => {
    expect(getPhotoTypeDisplay(mimeType)).toBe(expected);
  });

  it('falls back to uppercase subtype for unknown MIME types', () => {
    expect(getPhotoTypeDisplay('image/tiff')).toBe('TIFF');
  });

  it('returns Image when no subtype exists', () => {
    expect(getPhotoTypeDisplay('image')).toBe('Image');
  });
});
