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

const MATERIALIZED_FILE_OBJECT_TYPES = new Set<VfsObjectType>([
  'file',
  'photo',
  'audio',
  'video'
]);

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
  if (lowerName.endsWith('.svg')) {
    return 'image/svg+xml';
  }
  if (lowerName.endsWith('.png')) {
    return 'image/png';
  }
  if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) {
    return 'image/jpeg';
  }
  if (lowerName.endsWith('.gif')) {
    return 'image/gif';
  }
  if (lowerName.endsWith('.webp')) {
    return 'image/webp';
  }
  if (lowerName.endsWith('.mp3')) {
    return 'audio/mpeg';
  }
  if (lowerName.endsWith('.wav')) {
    return 'audio/wav';
  }
  if (lowerName.endsWith('.m4a')) {
    return 'audio/mp4';
  }
  if (lowerName.endsWith('.mp4')) {
    return 'video/mp4';
  }
  if (lowerName.endsWith('.mov')) {
    return 'video/quicktime';
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
    return Buffer.from(base64Value, 'base64').byteLength;
  } catch {
    return 0;
  }
}

export function buildMaterializedAlbumRows(
  registryRows: readonly RegistryRowForMaterialization[]
): Array<{
  id: string;
  encryptedName: string | null;
  encryptedDescription: null;
  coverPhotoId: null;
  albumType: 'custom';
}> {
  return registryRows
    .filter((entry) => entry.objectType === 'album')
    .map((entry) => ({
      id: entry.id,
      encryptedName: entry.encryptedName,
      encryptedDescription: null,
      coverPhotoId: null,
      albumType: 'custom'
    }));
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
        storagePath: `rematerialized/${entry.id}`,
        thumbnailPath: null,
        deleted: itemState?.deleted ?? false
      };
    });
}
