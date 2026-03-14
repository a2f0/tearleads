import type { VfsBlobDownloadFlusherPersistedState } from '@tearleads/api-client/clientEntry';
import { eq } from 'drizzle-orm';
import { getDatabase, isDatabaseInitialized } from '@/db';
import { userSettings } from '@/db/schema';

const VFS_BLOB_DOWNLOAD_STATE_KEY_PREFIX = 'vfs_blob_download_state';

function isDatabaseTransitionError(error: unknown): boolean {
  return (
    error instanceof Error && error.message.includes('Database not initialized')
  );
}

function buildStateKey(userId: string, clientId: string): string {
  return `${VFS_BLOB_DOWNLOAD_STATE_KEY_PREFIX}:${userId}:${clientId}`;
}

export async function loadVfsBlobDownloadState(
  userId: string,
  clientId: string
): Promise<VfsBlobDownloadFlusherPersistedState | null> {
  if (!isDatabaseInitialized()) {
    return null;
  }

  const key = buildStateKey(userId, clientId);
  try {
    const db = getDatabase();
    const rows = await db
      .select({ value: userSettings.value })
      .from(userSettings)
      .where(eq(userSettings.key, key))
      .limit(1);

    const row = rows[0];
    if (!row || !row.value) {
      return null;
    }

    try {
      return JSON.parse(row.value) as VfsBlobDownloadFlusherPersistedState;
    } catch {
      return null;
    }
  } catch (error) {
    if (isDatabaseTransitionError(error)) {
      return null;
    }
    throw error;
  }
}

export async function saveVfsBlobDownloadState(
  userId: string,
  clientId: string,
  state: VfsBlobDownloadFlusherPersistedState
): Promise<void> {
  if (!isDatabaseInitialized()) {
    return;
  }

  const key = buildStateKey(userId, clientId);
  const now = new Date();
  const value = JSON.stringify(state);
  try {
    const db = getDatabase();
    await db
      .insert(userSettings)
      .values({
        key,
        value,
        updatedAt: now
      })
      .onConflictDoUpdate({
        target: userSettings.key,
        set: {
          value,
          updatedAt: now
        }
      });
  } catch (error) {
    if (isDatabaseTransitionError(error)) {
      return;
    }
    throw error;
  }
}
