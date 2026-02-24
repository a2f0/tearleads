import type {
  VfsSecureOrchestratorFacade,
  VfsWriteOrchestrator
} from '@tearleads/api-client';
import type { VfsObjectType } from '@tearleads/shared';
import { eq } from 'drizzle-orm';
import { getDatabase } from '@/db';
import { vfsRegistry } from '@/db/schema';
import { generateSessionKey, wrapSessionKey } from '@/hooks/vfs';
import { api } from '@/lib/api';
import { isLoggedIn } from '@/lib/authStorage';
import { getFeatureFlagValue } from '@/lib/featureFlags';

interface VfsSyncRuntime {
  orchestrator: Pick<
    VfsWriteOrchestrator,
    'flushAll' | 'queueCrdtLocalOperationAndPersist'
  >;
  secureFacade: Pick<VfsSecureOrchestratorFacade, 'queueEncryptedCrdtOpAndPersist'>;
}

interface QueueItemUpsertAndFlushInput {
  itemId: string;
  objectType: VfsObjectType;
  payload: Record<string, unknown>;
  encryptedSessionKey?: string;
}

interface QueueItemDeleteAndFlushInput {
  itemId: string;
  objectType: VfsObjectType;
  encryptedSessionKey?: string;
}

let syncRuntime: VfsSyncRuntime | null = null;
const serverRegisteredItemIds = new Set<string>();

function shouldSyncToServer(): boolean {
  return isLoggedIn() && getFeatureFlagValue('vfsServerRegistration');
}

function getSyncRuntimeOrThrow(): VfsSyncRuntime {
  if (syncRuntime !== null) {
    return syncRuntime;
  }
  throw new Error(
    'VFS sync runtime is not initialized while signed-in item sync is enabled'
  );
}

export function setVfsItemSyncRuntime(runtime: VfsSyncRuntime | null): void {
  syncRuntime = runtime;
  if (runtime === null) {
    serverRegisteredItemIds.clear();
  }
}

async function readLocalRegistryRow(itemId: string): Promise<{
  objectType: string;
  encryptedSessionKey: string | null;
} | null> {
  const db = getDatabase();
  const rows = await db
    .select({
      objectType: vfsRegistry.objectType,
      encryptedSessionKey: vfsRegistry.encryptedSessionKey
    })
    .from(vfsRegistry)
    .where(eq(vfsRegistry.id, itemId))
    .limit(1);

  const row = rows[0];
  if (!row) {
    return null;
  }
  return {
    objectType: row.objectType,
    encryptedSessionKey: row.encryptedSessionKey
  };
}

async function ensureLocalEncryptedSessionKey(
  itemId: string,
  objectType: VfsObjectType,
  encryptedSessionKey?: string
): Promise<string> {
  if (encryptedSessionKey && encryptedSessionKey.length > 0) {
    return encryptedSessionKey;
  }

  const existing = await readLocalRegistryRow(itemId);
  if (!existing) {
    throw new Error(`VFS registry entry not found for item ${itemId}`);
  }

  if (existing.objectType !== objectType) {
    throw new Error(
      `VFS registry objectType mismatch for item ${itemId}: expected ${objectType}, got ${existing.objectType}`
    );
  }

  if (existing.encryptedSessionKey && existing.encryptedSessionKey.length > 0) {
    return existing.encryptedSessionKey;
  }

  const sessionKey = generateSessionKey();
  const wrappedSessionKey = await wrapSessionKey(sessionKey);
  const db = getDatabase();
  await db
    .update(vfsRegistry)
    .set({ encryptedSessionKey: wrappedSessionKey })
    .where(eq(vfsRegistry.id, itemId));
  return wrappedSessionKey;
}

function isAlreadyRegisteredError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.toLowerCase().includes('already registered')
  );
}

async function ensureServerRegistration(
  itemId: string,
  objectType: VfsObjectType,
  encryptedSessionKey: string
): Promise<void> {
  if (serverRegisteredItemIds.has(itemId)) {
    return;
  }

  try {
    await api.vfs.register({
      id: itemId,
      objectType,
      encryptedSessionKey
    });
  } catch (error) {
    if (!isAlreadyRegisteredError(error)) {
      throw error;
    }
  }

  serverRegisteredItemIds.add(itemId);
}

export async function queueItemUpsertAndFlush(
  input: QueueItemUpsertAndFlushInput
): Promise<void> {
  if (!shouldSyncToServer()) {
    return;
  }

  const runtime = getSyncRuntimeOrThrow();
  const sessionKey = await ensureLocalEncryptedSessionKey(
    input.itemId,
    input.objectType,
    input.encryptedSessionKey
  );
  await ensureServerRegistration(input.itemId, input.objectType, sessionKey);
  await runtime.secureFacade.queueEncryptedCrdtOpAndPersist({
    itemId: input.itemId,
    opType: 'item_upsert',
    opPayload: input.payload
  });
  await runtime.orchestrator.flushAll();
}

export async function queueItemDeleteAndFlush(
  input: QueueItemDeleteAndFlushInput
): Promise<void> {
  if (!shouldSyncToServer()) {
    return;
  }

  const runtime = getSyncRuntimeOrThrow();
  const sessionKey = await ensureLocalEncryptedSessionKey(
    input.itemId,
    input.objectType,
    input.encryptedSessionKey
  );
  await ensureServerRegistration(input.itemId, input.objectType, sessionKey);
  await runtime.orchestrator.queueCrdtLocalOperationAndPersist({
    itemId: input.itemId,
    opType: 'item_delete'
  });
  await runtime.orchestrator.flushAll();
}
