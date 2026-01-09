import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IAudioMetadata, ICommonTagsResult } from 'music-metadata';
import { extractAudioCoverArt, isAudioMimeType } from './audio-metadata';

vi.mock('music-metadata', () => ({
  parseBuffer: vi.fn()
}));

import { parseBuffer } from 'music-metadata';

const createMetadata = (
  overrides: Partial<ICommonTagsResult>
): IAudioMetadata => ({
  format: { trackInfo: [], tagTypes: [] },
  native: {},
  quality: { warnings: [] },
  common: {
    track: { no: null, of: null },
    disk: { no: null, of: null },
    ...overrides
  }
});

describe('audio-metadata', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('isAudioMimeType', () => {
    it('returns true for audio/mpeg', () => {
      expect(isAudioMimeType('audio/mpeg')).toBe(true);
    });

    it('returns true for audio/mp3', () => {
      expect(isAudioMimeType('audio/mp3')).toBe(true);
    });

    it('returns true for audio/flac', () => {
      expect(isAudioMimeType('audio/flac')).toBe(true);
    });

    it('returns true for audio/ogg', () => {
      expect(isAudioMimeType('audio/ogg')).toBe(true);
    });

    it('returns true for audio/mp4', () => {
      expect(isAudioMimeType('audio/mp4')).toBe(true);
    });

    it('returns true for audio/x-m4a', () => {
      expect(isAudioMimeType('audio/x-m4a')).toBe(true);
    });

    it('returns true for audio/aac', () => {
      expect(isAudioMimeType('audio/aac')).toBe(true);
    });

    it('returns true for audio/wav', () => {
      expect(isAudioMimeType('audio/wav')).toBe(true);
    });

    it('returns true for audio/wave', () => {
      expect(isAudioMimeType('audio/wave')).toBe(true);
    });

    it('returns true for audio/x-wav', () => {
      expect(isAudioMimeType('audio/x-wav')).toBe(true);
    });

    it('returns true for audio/webm', () => {
      expect(isAudioMimeType('audio/webm')).toBe(true);
    });

    it('returns true for audio/aiff', () => {
      expect(isAudioMimeType('audio/aiff')).toBe(true);
    });

    it('returns true for audio/x-aiff', () => {
      expect(isAudioMimeType('audio/x-aiff')).toBe(true);
    });

    it('returns false for image types', () => {
      expect(isAudioMimeType('image/jpeg')).toBe(false);
      expect(isAudioMimeType('image/png')).toBe(false);
    });

    it('returns false for video types', () => {
      expect(isAudioMimeType('video/mp4')).toBe(false);
    });

    it('returns false for application types', () => {
      expect(isAudioMimeType('application/pdf')).toBe(false);
    });
  });

  describe('extractAudioCoverArt', () => {
    it('returns cover art data and format when present', async () => {
      const coverArtData = new Uint8Array([1, 2, 3, 4, 5]);
      vi.mocked(parseBuffer).mockResolvedValue(
        createMetadata({
          picture: [{ data: coverArtData, format: 'image/jpeg' }]
        })
      );

      const audioData = new Uint8Array([10, 20, 30]);
      const result = await extractAudioCoverArt(audioData, 'audio/mpeg');

      expect(result).not.toBeNull();
      expect(result?.data).toEqual(coverArtData);
      expect(result?.format).toBe('image/jpeg');
      expect(parseBuffer).toHaveBeenCalledWith(audioData, {
        mimeType: 'audio/mpeg'
      });
    });

    it('returns null when no pictures are present', async () => {
      vi.mocked(parseBuffer).mockResolvedValue(
        createMetadata({
          picture: []
        })
      );

      const audioData = new Uint8Array([10, 20, 30]);
      const result = await extractAudioCoverArt(audioData, 'audio/mpeg');

      expect(result).toBeNull();
    });

    it('returns null when pictures array is undefined', async () => {
      vi.mocked(parseBuffer).mockResolvedValue(createMetadata({}));

      const audioData = new Uint8Array([10, 20, 30]);
      const result = await extractAudioCoverArt(audioData, 'audio/mpeg');

      expect(result).toBeNull();
    });

    it('returns null when parseBuffer throws an error', async () => {
      vi.mocked(parseBuffer).mockRejectedValue(new Error('Parse error'));

      const audioData = new Uint8Array([10, 20, 30]);
      const result = await extractAudioCoverArt(audioData, 'audio/mpeg');

      expect(result).toBeNull();
    });

    it('returns the first picture with its format when multiple are present', async () => {
      const firstCoverArt = new Uint8Array([1, 2, 3]);
      const secondCoverArt = new Uint8Array([4, 5, 6]);
      vi.mocked(parseBuffer).mockResolvedValue(
        createMetadata({
          picture: [
            { data: firstCoverArt, format: 'image/png' },
            { data: secondCoverArt, format: 'image/jpeg' }
          ]
        })
      );

      const audioData = new Uint8Array([10, 20, 30]);
      const result = await extractAudioCoverArt(audioData, 'audio/flac');

      expect(result?.data).toEqual(firstCoverArt);
      expect(result?.format).toBe('image/png');
    });
  });
});
