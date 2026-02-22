import { eq } from 'drizzle-orm';
import { getDatabase } from '@/db';
import { files, playlists } from '@/db/schema';

export type FileOpenTarget = 'audio' | 'document' | 'file' | 'photo' | 'video';
type PlaylistType = 'audio' | 'video';

export async function resolveFileOpenTarget(
  fileId: string
): Promise<FileOpenTarget> {
  try {
    const db = getDatabase();
    const [row] = await db
      .select({ mimeType: files.mimeType })
      .from(files)
      .where(eq(files.id, fileId))
      .limit(1);

    const mimeType = row?.mimeType ?? '';
    if (mimeType === 'application/pdf') {
      return 'document';
    }

    const baseType = mimeType.split('/')[0] ?? '';
    switch (baseType) {
      case 'image':
        return 'photo';
      case 'audio':
        return 'audio';
      case 'video':
        return 'video';
      default:
        return 'file';
    }
  } catch (err) {
    console.warn('Failed to resolve file open target:', err);
    return 'file';
  }
}

export async function resolvePlaylistType(
  playlistId: string
): Promise<PlaylistType> {
  try {
    const db = getDatabase();
    const [row] = await db
      .select({ mediaType: playlists.mediaType })
      .from(playlists)
      .where(eq(playlists.id, playlistId))
      .limit(1);

    return row?.mediaType === 'video' ? 'video' : 'audio';
  } catch (err) {
    console.warn('Failed to resolve playlist type:', err);
    return 'audio';
  }
}
