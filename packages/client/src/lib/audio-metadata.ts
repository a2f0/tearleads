/**
 * Audio metadata extraction utility.
 * Uses music-metadata to parse ID3 tags and extract embedded cover art.
 */

import { parseBuffer } from 'music-metadata';

const AUDIO_MIME_TYPES = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/flac',
  'audio/ogg',
  'audio/mp4',
  'audio/x-m4a',
  'audio/aac',
  'audio/wav',
  'audio/wave',
  'audio/x-wav',
  'audio/webm',
  'audio/aiff',
  'audio/x-aiff'
]);

export interface CoverArtInfo {
  data: Uint8Array;
  format: string;
}

/**
 * Check if a MIME type is an audio format that may contain embedded cover art.
 */
export function isAudioMimeType(mimeType: string): boolean {
  return AUDIO_MIME_TYPES.has(mimeType);
}

/**
 * Extract embedded cover art from audio file data.
 * Returns the cover art data and format, or null if none exists.
 */
export async function extractAudioCoverArt(
  audioData: Uint8Array,
  mimeType: string
): Promise<CoverArtInfo | null> {
  try {
    const metadata = await parseBuffer(audioData, { mimeType });

    const pictures = metadata.common.picture;
    const coverArt = pictures?.[0];
    if (!coverArt?.data) {
      return null;
    }

    return {
      data: new Uint8Array(coverArt.data),
      format: coverArt.format
    };
  } catch (err) {
    console.warn(
      `Failed to extract audio cover art for mimeType ${mimeType}:`,
      err
    );
    return null;
  }
}
