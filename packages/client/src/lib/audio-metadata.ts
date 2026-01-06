/**
 * Audio metadata extraction utility.
 * Uses music-metadata-browser to parse ID3 tags and extract embedded cover art.
 */

import { parseBuffer } from 'music-metadata-browser';

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

/**
 * Check if a MIME type is an audio format that may contain embedded cover art.
 */
export function isAudioMimeType(mimeType: string): boolean {
  return AUDIO_MIME_TYPES.has(mimeType);
}

/**
 * Extract embedded cover art from audio file data.
 * Returns the cover art as a Uint8Array, or null if none exists.
 */
export async function extractAudioCoverArt(
  audioData: Uint8Array,
  mimeType: string
): Promise<Uint8Array | null> {
  try {
    const metadata = await parseBuffer(audioData, { mimeType });

    const pictures = metadata.common.picture;
    const coverArt = pictures?.[0];
    if (!coverArt) {
      return null;
    }

    return new Uint8Array(coverArt.data);
  } catch {
    return null;
  }
}
