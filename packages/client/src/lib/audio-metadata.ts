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

export interface AudioMetadata {
  title: string | null;
  artist: string | null;
  album: string | null;
  albumArtist: string | null;
  year: number | null;
  trackNumber: number | null;
  trackTotal: number | null;
  genre: string[] | null;
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

/**
 * Extract common audio metadata fields from an audio file.
 * Returns null if no metadata is present or parsing fails.
 */
export async function extractAudioMetadata(
  audioData: Uint8Array,
  mimeType: string
): Promise<AudioMetadata | null> {
  try {
    const metadata = await parseBuffer(audioData, { mimeType });
    const common = metadata.common;

    const result: AudioMetadata = {
      title: common.title ?? null,
      artist: common.artist ?? null,
      album: common.album ?? null,
      albumArtist: common.albumartist ?? null,
      year: common.year ?? null,
      trackNumber: common.track?.no ?? null,
      trackTotal: common.track?.of ?? null,
      genre: common.genre ?? null
    };

    const hasMetadata =
      (result.title?.trim()?.length ?? 0) > 0 ||
      (result.artist?.trim()?.length ?? 0) > 0 ||
      (result.album?.trim()?.length ?? 0) > 0 ||
      (result.albumArtist?.trim()?.length ?? 0) > 0 ||
      result.year !== null ||
      result.trackNumber !== null ||
      result.trackTotal !== null ||
      (result.genre?.length ?? 0) > 0;

    return hasMetadata ? result : null;
  } catch (err) {
    console.warn(
      `Failed to extract audio metadata for mimeType ${mimeType}:`,
      err
    );
    return null;
  }
}
