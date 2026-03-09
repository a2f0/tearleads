import type {
  VfsSecureOrchestratorFacade,
  VfsWriteOrchestrator
} from '@tearleads/api-client/clientEntry';
import type { VfsObjectType } from '@tearleads/shared';
import { eq } from 'drizzle-orm';
import { getDatabase } from '@/db';
import { vfsRegistry } from '@/db/schema';
import {
  getInstanceChangeSnapshot,
  type InstanceChangeSnapshot
} from '@/hooks/app/useInstanceChange';
import { generateSessionKey, wrapSessionKey } from '@/hooks/vfs';
import { api } from '@/lib/api';
import { isLoggedIn, readStoredAuth } from '@/lib/authStorage';
import { getFeatureFlagValue } from '@/lib/featureFlags';
import { isVfsAlreadyRegisteredError } from '@/lib/vfsRegistrationErrors';

interface VfsSyncRuntimeBinding {
  currentInstanceId: string | null;
  instanceEpoch: number;
}

interface VfsSyncRuntime extends VfsSyncRuntimeBinding {
  orchestrator: Pick<
    VfsWriteOrchestrator,
    'flushAll' | 'queueCrdtLocalOperationAndPersist'
  >;
  secureFacade: Pick<
    VfsSecureOrchestratorFacade,
    'queueEncryptedCrdtOpAndPersist'
  >;
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

let uploadInflightCount = 0;
let downloadInflightCount = 0;
let lastSyncError: Error | null = null;
const syncActivityListeners = new Set<() => void>();

function resetRuntimeState(): void {
  serverRegisteredItemIds.clear();
  uploadInflightCount = 0;
  downloadInflightCount = 0;
  lastSyncError = null;
  notifySyncActivityListeners();
}

function notifySyncActivityListeners(): void {
  for (const listener of syncActivityListeners) {
    listener();
  }
}

export function getSyncActivity(): {
  uploadInflightCount: number;
  downloadInflightCount: number;
  lastSyncError: Error | null;
} {
  return { uploadInflightCount, downloadInflightCount, lastSyncError };
}

export function subscribeSyncActivity(cb: () => void): () => void {
  syncActivityListeners.add(cb);
  return () => {
    syncActivityListeners.delete(cb);
  };
}

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
  resetRuntimeState();
}

function snapshotsMatch(
  left: VfsSyncRuntimeBinding,
  right: VfsSyncRuntimeBinding
): boolean {
  return (
    left.currentInstanceId === right.currentInstanceId &&
    left.instanceEpoch === right.instanceEpoch
  );
}

function formatRuntimeSnapshot(snapshot: VfsSyncRuntimeBinding): string {
  return `instanceId=${snapshot.currentInstanceId ?? 'none'}, instanceEpoch=${snapshot.instanceEpoch}`;
}

function assertRuntimeMatchesActiveInstance(
  runtime: VfsSyncRuntime,
  phase: string
): InstanceChangeSnapshot {
  const activeSnapshot = getInstanceChangeSnapshot();
  if (snapshotsMatch(runtime, activeSnapshot)) {
    return activeSnapshot;
  }

  throw new Error(
    `VFS sync runtime is stale during ${phase}. runtime(${formatRuntimeSnapshot(runtime)}), active(${formatRuntimeSnapshot(activeSnapshot)})`
  );
}

async function readLocalRegistryRow(itemId: string): Promise<{
  objectType: string;
  encryptedSessionKey: string | null;
  ownerId: string | null;
} | null> {
  const db = getDatabase();
  const rows = await db
    .select({
      objectType: vfsRegistry.objectType,
      encryptedSessionKey: vfsRegistry.encryptedSessionKey,
      ownerId: vfsRegistry.ownerId
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
    encryptedSessionKey: row.encryptedSessionKey,
    ownerId: row.ownerId
  };
}

function getCurrentUserId(): string | null {
  return readStoredAuth().user?.id ?? null;
}

async function ensureLocalEncryptedSessionKey(
  itemId: string,
  objectType: VfsObjectType,
  encryptedSessionKey?: string
): Promise<{ encryptedSessionKey: string; ownerId: string | null }> {
  const existing = await readLocalRegistryRow(itemId);
  if (existing && existing.objectType !== objectType) {
    throw new Error(
      `VFS registry objectType mismatch for item ${itemId}: expected ${objectType}, got ${existing.objectType}`
    );
  }

  if (encryptedSessionKey && encryptedSessionKey.length > 0) {
    return {
      encryptedSessionKey,
      ownerId: existing?.ownerId ?? null
    };
  }

  if (!existing) {
    throw new Error(`VFS registry entry not found for item ${itemId}`);
  }

  if (existing.encryptedSessionKey && existing.encryptedSessionKey.length > 0) {
    return {
      encryptedSessionKey: existing.encryptedSessionKey,
      ownerId: existing.ownerId
    };
  }

  const currentUserId = getCurrentUserId();
  if (currentUserId && existing.ownerId && existing.ownerId !== currentUserId) {
    // Shared items may not have a local wrapped session key row yet.
    // Skip local key synthesis; register is skipped for non-owned items.
    return {
      encryptedSessionKey: '',
      ownerId: existing.ownerId
    };
  }

  const sessionKey = generateSessionKey();
  const wrappedSessionKey = await wrapSessionKey(sessionKey);
  const db = getDatabase();
  await db
    .update(vfsRegistry)
    .set({ encryptedSessionKey: wrappedSessionKey })
    .where(eq(vfsRegistry.id, itemId));
  return {
    encryptedSessionKey: wrappedSessionKey,
    ownerId: existing.ownerId
  };
}

async function ensureServerRegistration(
  itemId: string,
  objectType: VfsObjectType,
  encryptedSessionKey: string,
  ownerId: string | null
): Promise<void> {
  if (serverRegisteredItemIds.has(itemId)) {
    return;
  }

  const currentUserId = getCurrentUserId();
  if (currentUserId && ownerId && ownerId !== currentUserId) {
    // Shared items are already registered by the owner; skip duplicate register.
    serverRegisteredItemIds.add(itemId);
    return;
  }

  try {
    await api.vfs.register({
      id: itemId,
      objectType,
      encryptedSessionKey
    });
  } catch (error) {
    if (!isVfsAlreadyRegisteredError(error)) {
      throw error;
    }
  }

  serverRegisteredItemIds.add(itemId);
}

function encodeBase64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function buildSyntheticEnvelopeField(
  field: 'nonce' | 'aad' | 'signature',
  itemId: string,
  encodedPayload: string
): string {
  return encodeBase64Utf8(`${field}:${itemId}:${encodedPayload}`);
}

async function withSyncTracking(operation: () => Promise<void>): Promise<void> {
  uploadInflightCount++;
  notifySyncActivityListeners();
  try {
    await operation();
    lastSyncError = null;
  } catch (error) {
    lastSyncError = error instanceof Error ? error : new Error(String(error));
    throw error;
  } finally {
    uploadInflightCount--;
    notifySyncActivityListeners();
  }
}

export async function withDownloadTracking(
  operation: () => Promise<void>
): Promise<void> {
  downloadInflightCount++;
  notifySyncActivityListeners();
  try {
    await operation();
    lastSyncError = null;
  } catch (error) {
    lastSyncError = error instanceof Error ? error : new Error(String(error));
    throw error;
  } finally {
    downloadInflightCount--;
    notifySyncActivityListeners();
  }
}

export async function queueItemUpsertAndFlush(
  input: QueueItemUpsertAndFlushInput
): Promise<void> {
  if (!shouldSyncToServer()) {
    return;
  }

  await withSyncTracking(async () => {
    const runtime = getSyncRuntimeOrThrow();
    assertRuntimeMatchesActiveInstance(runtime, 'preflight');
    const localKeyContext = await ensureLocalEncryptedSessionKey(
      input.itemId,
      input.objectType,
      input.encryptedSessionKey
    );
    assertRuntimeMatchesActiveInstance(runtime, 'register');
    await ensureServerRegistration(
      input.itemId,
      input.objectType,
      localKeyContext.encryptedSessionKey,
      localKeyContext.ownerId
    );

    if (input.objectType === 'note') {
      const content =
        typeof input.payload['content'] === 'string'
          ? input.payload['content']
          : '';
      const encodedPayload = encodeBase64Utf8(content);
      await runtime.orchestrator.queueCrdtLocalOperationAndPersist({
        itemId: input.itemId,
        opType: 'item_upsert',
        encryptedPayload: encodedPayload,
        keyEpoch: 1,
        encryptionNonce: buildSyntheticEnvelopeField(
          'nonce',
          input.itemId,
          encodedPayload
        ),
        encryptionAad: buildSyntheticEnvelopeField(
          'aad',
          input.itemId,
          encodedPayload
        ),
        encryptionSignature: buildSyntheticEnvelopeField(
          'signature',
          input.itemId,
          encodedPayload
        )
      });
    } else {
      await runtime.secureFacade.queueEncryptedCrdtOpAndPersist({
        itemId: input.itemId,
        opType: 'item_upsert',
        opPayload: input.payload
      });
    }
    assertRuntimeMatchesActiveInstance(runtime, 'flush');
    await runtime.orchestrator.flushAll();
  });
}

export async function queueItemDeleteAndFlush(
  input: QueueItemDeleteAndFlushInput
): Promise<void> {
  if (!shouldSyncToServer()) {
    return;
  }

  await withSyncTracking(async () => {
    const runtime = getSyncRuntimeOrThrow();
    assertRuntimeMatchesActiveInstance(runtime, 'preflight');
    const localKeyContext = await ensureLocalEncryptedSessionKey(
      input.itemId,
      input.objectType,
      input.encryptedSessionKey
    );
    assertRuntimeMatchesActiveInstance(runtime, 'register');
    await ensureServerRegistration(
      input.itemId,
      input.objectType,
      localKeyContext.encryptedSessionKey,
      localKeyContext.ownerId
    );
    await runtime.orchestrator.queueCrdtLocalOperationAndPersist({
      itemId: input.itemId,
      opType: 'item_delete'
    });
    assertRuntimeMatchesActiveInstance(runtime, 'flush');
    await runtime.orchestrator.flushAll();
  });
}
