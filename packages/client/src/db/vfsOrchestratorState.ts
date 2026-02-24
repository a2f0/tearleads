import type { VfsWriteOrchestratorPersistedState } from '@tearleads/api-client';
import { eq } from 'drizzle-orm';
import { getDatabase, isDatabaseInitialized } from '@/db';
import { userSettings } from '@/db/schema';

const VFS_ORCHESTRATOR_STATE_KEY_PREFIX = 'vfs_orchestrator_state';

function buildStateKey(userId: string, clientId: string): string {
  return `${VFS_ORCHESTRATOR_STATE_KEY_PREFIX}:${userId}:${clientId}`;
}

export async function loadVfsOrchestratorState(
  userId: string,
  clientId: string
): Promise<VfsWriteOrchestratorPersistedState | null> {
  if (!isDatabaseInitialized()) {
    return null;
  }

  const db = getDatabase();
  const key = buildStateKey(userId, clientId);
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
    return JSON.parse(row.value) as VfsWriteOrchestratorPersistedState;
  } catch {
    return null;
  }
}

export async function saveVfsOrchestratorState(
  userId: string,
  clientId: string,
  state: VfsWriteOrchestratorPersistedState
): Promise<void> {
  if (!isDatabaseInitialized()) {
    return;
  }

  const db = getDatabase();
  const key = buildStateKey(userId, clientId);
  const now = new Date();
  const value = JSON.stringify(state);
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
}

export async function clearVfsOrchestratorState(
  userId: string,
  clientId: string
): Promise<void> {
  if (!isDatabaseInitialized()) {
    return;
  }

  const db = getDatabase();
  const key = buildStateKey(userId, clientId);
  await db.delete(userSettings).where(eq(userSettings.key, key));
}
