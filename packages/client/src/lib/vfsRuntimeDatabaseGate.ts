import type { InstanceMetadata } from '@/db/instanceRegistry';

export interface VfsRuntimeDatabaseContext {
  currentInstanceId: string | null;
  db: object | null;
  instances: InstanceMetadata[];
  isLoading: boolean;
}

interface IsVfsRuntimeDatabaseReadyInput {
  databaseContext: VfsRuntimeDatabaseContext | null;
  userId: string | null;
}

export function isVfsRuntimeDatabaseReady(
  input: IsVfsRuntimeDatabaseReadyInput
): boolean {
  const { databaseContext, userId } = input;

  if (!userId) {
    return false;
  }

  if (databaseContext === null) {
    return true;
  }

  if (
    databaseContext.isLoading ||
    !databaseContext.db ||
    !databaseContext.currentInstanceId
  ) {
    return false;
  }

  const currentInstance = databaseContext.instances.find(
    (instance) => instance.id === databaseContext.currentInstanceId
  );
  return currentInstance?.boundUserId === userId;
}
