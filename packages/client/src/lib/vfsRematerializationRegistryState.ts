import type { VfsObjectType, VfsSyncItem } from '@tearleads/shared';
import { VFS_OBJECT_TYPES } from '@tearleads/shared';
import { parseTimestampMs } from './vfsRematerializationUtils';

export interface RegistryRowState {
  id: string;
  objectType: VfsObjectType;
  encryptedName: string | null;
  ownerId: string | null;
  createdAtMs: number;
}

function isVfsObjectType(value: string): value is VfsObjectType {
  return VFS_OBJECT_TYPES.some((objectType) => objectType === value);
}

export function applySyncItemToRegistryState(
  registryById: Map<string, RegistryRowState>,
  item: VfsSyncItem
): void {
  if (item.changeType === 'delete') {
    registryById.delete(item.itemId);
    return;
  }
  if (!item.objectType || !isVfsObjectType(item.objectType)) {
    return;
  }

  const createdAtMs = parseTimestampMs(
    item.createdAt,
    parseTimestampMs(item.changedAt, Date.now())
  );
  registryById.set(item.itemId, {
    id: item.itemId,
    objectType: item.objectType,
    encryptedName:
      typeof item.encryptedName === 'string' ? item.encryptedName : null,
    ownerId: item.ownerId,
    createdAtMs
  });
}
