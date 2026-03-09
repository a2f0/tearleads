/**
 * Album utilities for managing virtual albums derived from audio metadata.
 *
 * Albums in the audio system are not first-class database entities - they are
 * derived from track metadata (album name and album artist). This module provides
 * utilities for creating deterministic album IDs and parsing album information.
 */

/**
 * Separator used in album ID encoding.
 * Using a null character as it's unlikely to appear in album/artist names.
 */
const ALBUM_ID_SEPARATOR = '\0';

/**
 * Prefix for album IDs to distinguish them from other entity IDs.
 */
const ALBUM_ID_PREFIX = 'album::';

/**
 * Creates a deterministic album ID from album name and artist.
 * The ID is a base64-encoded string of the format "album::name\0artist".
 *
 * @param albumName - The album name from track metadata
 * @param albumArtist - The album artist from track metadata (optional)
 * @returns A deterministic album ID string
 */
export function createAlbumId(
  albumName: string,
  albumArtist?: string | null
): string {
  const normalized = `${ALBUM_ID_PREFIX}${albumName}${ALBUM_ID_SEPARATOR}${albumArtist ?? ''}`;
  return btoa(encodeURIComponent(normalized));
}

/**
 * Parses an album ID to extract the album name and artist.
 *
 * @param albumId - The album ID to parse
 * @returns An object with album name and artist, or null if invalid
 */
export function parseAlbumId(
  albumId: string
): { name: string; artist: string | null } | null {
  try {
    const decoded = decodeURIComponent(atob(albumId));
    if (!decoded.startsWith(ALBUM_ID_PREFIX)) {
      return null;
    }
    const content = decoded.slice(ALBUM_ID_PREFIX.length);
    const separatorIndex = content.indexOf(ALBUM_ID_SEPARATOR);
    if (separatorIndex === -1) {
      return null;
    }
    const name = content.slice(0, separatorIndex);
    const artist = content.slice(separatorIndex + 1) || null;
    return { name, artist };
  } catch {
    return null;
  }
}

/**
 * Checks if an album ID is valid.
 *
 * @param albumId - The album ID to validate
 * @returns True if the album ID is valid
 */
export function isValidAlbumId(albumId: string): boolean {
  return parseAlbumId(albumId) !== null;
}

/**
 * Special constant representing "no album filter" (show all tracks).
 */
export const ALL_ALBUMS_ID = 'all-albums';
