import { broadcast } from './broadcast.js';

const VFS_CONTAINER_CHANNEL_PREFIX = 'vfs:container:';
const VFS_CONTAINER_CHANNEL_SUFFIX = ':sync';

export interface VfsContainerCursor {
  changedAt: string;
  changeId: string;
}

export interface VfsCursorBumpMessagePayload extends VfsContainerCursor {
  containerId: string;
  actorId: string;
  sourceClientId: string;
}

function toVfsContainerSyncChannel(containerId: string): string {
  return `${VFS_CONTAINER_CHANNEL_PREFIX}${containerId}${VFS_CONTAINER_CHANNEL_SUFFIX}`;
}

export function parseVfsContainerIdFromSyncChannel(
  channel: string
): string | null {
  if (
    !channel.startsWith(VFS_CONTAINER_CHANNEL_PREFIX) ||
    !channel.endsWith(VFS_CONTAINER_CHANNEL_SUFFIX)
  ) {
    return null;
  }

  const containerId = channel.slice(
    VFS_CONTAINER_CHANNEL_PREFIX.length,
    channel.length - VFS_CONTAINER_CHANNEL_SUFFIX.length
  );
  const trimmedContainerId = containerId.trim();
  return trimmedContainerId.length > 0 ? trimmedContainerId : null;
}

export async function publishVfsContainerCursorBump(
  payload: VfsCursorBumpMessagePayload
): Promise<void> {
  await broadcast(toVfsContainerSyncChannel(payload.containerId), {
    type: 'vfs:cursor-bump',
    payload,
    timestamp: new Date().toISOString()
  });
}
