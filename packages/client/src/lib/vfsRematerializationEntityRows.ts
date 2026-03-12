import type { VfsObjectType } from '@tearleads/shared';

interface RegistryRowForMaterialization {
  id: string;
  objectType: VfsObjectType;
  encryptedName: string | null;
  createdAt: Date;
}

interface ItemStateForMaterialization {
  encryptedPayload: string | null;
  deleted: boolean;
}

interface MaterializedAlbumRow {
  id: string;
  encryptedName: string | null;
  encryptedDescription: null;
  coverPhotoId: null;
  albumType: 'custom';
}

interface MaterializedPlaylistRow {
  id: string;
  encryptedName: string | null;
  encryptedDescription: null;
  coverImageId: null;
  shuffleMode: number;
  mediaType: 'audio';
}

interface MaterializedCollectionRows {
  albumRows: MaterializedAlbumRow[];
  playlistRows: MaterializedPlaylistRow[];
}

const MATERIALIZED_FILE_OBJECT_TYPES = new Set<VfsObjectType>([
  'file',
  'photo',
  'audio',
  'video'
]);
const REMATERIALIZED_STORAGE_PREFIX = 'rematerialized-';
const REMATERIALIZED_STORAGE_SUFFIX = '.enc';

const EXTENSION_TO_MIME_TYPE: Readonly<Record<string, string>> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime'
};

function resolveMaterializedFileName(
  encryptedName: string | null,
  objectType: VfsObjectType
): string {
  const trimmedName = encryptedName?.trim();
  if (trimmedName && trimmedName.length > 0) {
    return trimmedName;
  }
  if (objectType === 'photo') {
    return 'Untitled Photo';
  }
  if (objectType === 'audio') {
    return 'Untitled Audio';
  }
  if (objectType === 'video') {
    return 'Untitled Video';
  }
  return 'Untitled File';
}

function inferMimeTypeFromFileName(
  fileName: string,
  objectType: VfsObjectType
): string {
  const lowerName = fileName.toLowerCase();

  for (const [extension, mimeType] of Object.entries(EXTENSION_TO_MIME_TYPE)) {
    if (lowerName.endsWith(extension)) {
      return mimeType;
    }
  }
  if (objectType === 'photo') {
    return 'image/jpeg';
  }
  if (objectType === 'audio') {
    return 'audio/mpeg';
  }
  if (objectType === 'video') {
    return 'video/mp4';
  }
  return 'application/octet-stream';
}

function decodeBase64Size(base64Value: string | null | undefined): number {
  if (!base64Value) {
    return 0;
  }
  try {
    const normalized = base64Value
      .trim()
      .replace(/\s+/g, '')
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    if (normalized.length === 0) {
      return 0;
    }
    const missingPadding = normalized.length % 4;
    const padded =
      missingPadding === 0
        ? normalized
        : `${normalized}${'='.repeat(4 - missingPadding)}`;
    return atob(padded).length;
  } catch {
    return 0;
  }
}

function sanitizeStoragePathSegment(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9._-]/g, '-');
  return sanitized.length > 0 ? sanitized : 'item';
}

function getMaterializedStoragePath(itemId: string): string {
  return `${REMATERIALIZED_STORAGE_PREFIX}${sanitizeStoragePathSegment(itemId)}${REMATERIALIZED_STORAGE_SUFFIX}`;
}

export function buildMaterializedCollectionRows(
  registryRows: readonly RegistryRowForMaterialization[]
): MaterializedCollectionRows {
  const albumRows: MaterializedAlbumRow[] = [];
  const playlistRows: MaterializedPlaylistRow[] = [];

  for (const entry of registryRows) {
    if (entry.objectType === 'album') {
      albumRows.push({
        id: entry.id,
        encryptedName: entry.encryptedName,
        encryptedDescription: null,
        coverPhotoId: null,
        albumType: 'custom'
      });
      continue;
    }

    if (entry.objectType === 'playlist') {
      playlistRows.push({
        id: entry.id,
        encryptedName: entry.encryptedName,
        encryptedDescription: null,
        coverImageId: null,
        shuffleMode: 0,
        mediaType: 'audio'
      });
    }
  }

  return { albumRows, playlistRows };
}

export function buildMaterializedFileRows(
  registryRows: readonly RegistryRowForMaterialization[],
  itemStateByItemId: ReadonlyMap<string, ItemStateForMaterialization>
): Array<{
  id: string;
  name: string;
  size: number;
  mimeType: string;
  uploadDate: Date;
  contentHash: string;
  storagePath: string;
  thumbnailPath: null;
  deleted: boolean;
}> {
  return registryRows
    .filter((entry) => MATERIALIZED_FILE_OBJECT_TYPES.has(entry.objectType))
    .map((entry) => {
      const itemState = itemStateByItemId.get(entry.id);
      const fileName = resolveMaterializedFileName(
        entry.encryptedName,
        entry.objectType
      );
      return {
        id: entry.id,
        name: fileName,
        size: decodeBase64Size(itemState?.encryptedPayload),
        mimeType: inferMimeTypeFromFileName(fileName, entry.objectType),
        uploadDate: new Date(entry.createdAt.getTime()),
        contentHash: `rematerialized:${entry.id}`,
        storagePath: getMaterializedStoragePath(entry.id),
        thumbnailPath: null,
        deleted: itemState?.deleted ?? false
      };
    });
}
