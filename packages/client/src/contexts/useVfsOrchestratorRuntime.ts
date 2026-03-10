import {
  createVfsSecurePipelineBundle,
  type VfsKeyManager,
  type VfsSecureOrchestratorFacade,
  VfsWriteOrchestrator
} from '@tearleads/api-client/clientEntry';
import {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore
} from 'react';
import { getDatabase, isDatabaseInitialized } from '@/db';
import { logEvent } from '@/db/analytics';
import { DatabaseContext } from '@/db/hooks/useDatabaseContext';
import { createItemKeyStore } from '@/db/vfsItemKeys';
import {
  loadVfsOrchestratorState,
  saveVfsOrchestratorState
} from '@/db/vfsOrchestratorState';
import { createRecipientPublicKeyResolver } from '@/db/vfsRecipientKeyResolver';
import { createUserKeyProvider } from '@/db/vfsUserKeyProvider';
import {
  getInstanceChangeSnapshot,
  type InstanceChangeSnapshot,
  subscribeToInstanceChange
} from '@/hooks/app/useInstanceChange';
import { ensureVfsKeys } from '@/hooks/vfs';
import {
  getActiveOrganizationId,
  hasActiveOrganizationId,
  onOrgChange
} from '@/lib/orgStorage';
import { setVfsItemSyncRuntime } from '@/lib/vfsItemSyncWriter';
import { rematerializeRemoteVfsStateIfNeeded } from '@/lib/vfsRematerialization';
import { isVfsRuntimeDatabaseReady } from '@/lib/vfsRuntimeDatabaseGate';
import { isVfsTransientInstanceSwitchError } from '@/lib/vfsSyncErrorClassification';
import { useAuth } from './AuthContext';

function normalizeApiPrefix(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return '';
  }
  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLeadingSlash.endsWith('/')
    ? withLeadingSlash.slice(0, -1)
    : withLeadingSlash;
}

function formatEpochTrace(
  startedSnapshot: InstanceChangeSnapshot,
  currentSnapshot: InstanceChangeSnapshot
): string {
  return `instanceEpoch=${startedSnapshot.instanceEpoch}, currentInstanceEpoch=${currentSnapshot.instanceEpoch}, instanceId=${startedSnapshot.currentInstanceId ?? 'none'}, currentInstanceId=${currentSnapshot.currentInstanceId ?? 'none'}`;
}

function useRuntimeSnapshot(): InstanceChangeSnapshot {
  return useSyncExternalStore(
    (onStoreChange) => subscribeToInstanceChange(() => onStoreChange()),
    getInstanceChangeSnapshot
  );
}

function useFlushWhenOrganizationReady(input: {
  orchestrator: VfsWriteOrchestrator | null;
  isAuthenticated: boolean;
}): void {
  const { orchestrator, isAuthenticated } = input;

  useEffect(() => {
    if (!orchestrator || !isAuthenticated) {
      return;
    }

    const flushWhenOrganizationReady = () => {
      if (!hasActiveOrganizationId()) {
        return;
      }

      const flushSnapshot = getInstanceChangeSnapshot();
      void orchestrator.flushAll().catch((flushErr) => {
        if (isVfsTransientInstanceSwitchError(flushErr)) {
          return;
        }
        console.warn(
          'Initial VFS orchestrator flush failed:',
          formatEpochTrace(flushSnapshot, getInstanceChangeSnapshot()),
          flushErr
        );
      });
    };

    flushWhenOrganizationReady();
    return onOrgChange(flushWhenOrganizationReady);
  }, [orchestrator, isAuthenticated]);
}

interface UseVfsOrchestratorRuntimeInput {
  baseUrl: string | undefined;
  apiPrefix: string;
}

interface UseVfsOrchestratorRuntimeResult {
  orchestrator: VfsWriteOrchestrator | null;
  secureFacade: VfsSecureOrchestratorFacade | null;
  keyManager: VfsKeyManager | null;
  isInitializing: boolean;
  error: Error | null;
  initialize: () => Promise<void>;
}

export function useVfsOrchestratorRuntime(
  input: UseVfsOrchestratorRuntimeInput
): UseVfsOrchestratorRuntimeResult {
  const orchestratorClientId = 'client';
  const { user, isAuthenticated } = useAuth();
  const databaseContext = useContext(DatabaseContext);
  const runtimeSnapshot = useRuntimeSnapshot();
  const [orchestrator, setOrchestrator] = useState<VfsWriteOrchestrator | null>(
    null
  );
  const [secureFacade, setSecureFacade] =
    useState<VfsSecureOrchestratorFacade | null>(null);
  const [keyManager, setKeyManager] = useState<VfsKeyManager | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const initializeRunIdRef = useRef(0);
  const hasDatabaseContextRef = useRef(false);
  const databaseReadyRef = useRef(false);
  const databaseInstanceIdRef = useRef<string | null>(null);

  const effectiveBaseUrl = input.baseUrl ?? import.meta.env.VITE_API_URL ?? '';
  const effectiveApiPrefix = normalizeApiPrefix(input.apiPrefix);
  const hasDatabaseContext = databaseContext !== null;
  const currentDatabaseInstanceId = databaseContext?.currentInstanceId ?? null;
  const isDatabaseReady = isVfsRuntimeDatabaseReady({
    databaseContext,
    userId: user?.id ?? null
  });

  hasDatabaseContextRef.current = hasDatabaseContext;
  databaseReadyRef.current = isDatabaseReady;
  databaseInstanceIdRef.current = currentDatabaseInstanceId;

  const resetRuntime = useCallback(() => {
    setOrchestrator(null);
    setSecureFacade(null);
    setKeyManager(null);
    setVfsItemSyncRuntime(null);
  }, []);

  const logBlobFlushOperationTelemetry = useCallback(
    async (event: {
      operationKind: 'stage' | 'attach' | 'abandon' | 'chunk' | 'commit';
      attempts: number;
      retryCount: number;
      success: boolean;
      failureClass?: 'http_status' | 'network' | 'unknown' | undefined;
      statusCode?: number | undefined;
      retryable?: boolean | undefined;
    }): Promise<void> => {
      // Keep chunk-volume noise low: log chunks only when they retried or failed.
      if (
        event.operationKind === 'chunk' &&
        event.success &&
        event.retryCount === 0
      ) {
        return;
      }

      if (!isDatabaseInitialized()) {
        return;
      }

      try {
        const db = getDatabase();
        await logEvent(db, 'vfs_blob_flush_operation', 0, event.success, {
          operationKind: event.operationKind,
          attempts: event.attempts,
          retryCount: event.retryCount,
          ...(event.failureClass && { failureClass: event.failureClass }),
          ...(event.statusCode !== undefined && {
            statusCode: event.statusCode
          }),
          ...(event.retryable !== undefined && { retryable: event.retryable })
        });
      } catch (err) {
        console.warn('Failed to log vfs_blob_flush_operation event:', err);
      }
    },
    []
  );

  const initialize = useCallback(async () => {
    const runId = initializeRunIdRef.current + 1;
    initializeRunIdRef.current = runId;

    if (
      !user ||
      !isAuthenticated ||
      runtimeSnapshot.currentInstanceId === null ||
      !isDatabaseReady ||
      (hasDatabaseContext &&
        currentDatabaseInstanceId !== runtimeSnapshot.currentInstanceId)
    ) {
      resetRuntime();
      setIsInitializing(false);
      return;
    }

    resetRuntime();
    setIsInitializing(true);
    setError(null);

    try {
      const nextOrchestrator = new VfsWriteOrchestrator(user.id, 'client', {
        crdt: {
          transportOptions: {
            baseUrl: effectiveBaseUrl,
            apiPrefix: effectiveApiPrefix,
            getOrganizationId: getActiveOrganizationId
          },
          onRematerializationRequired: async () => {
            const rematerializationSnapshot = getInstanceChangeSnapshot();
            if (
              !databaseReadyRef.current ||
              (hasDatabaseContextRef.current &&
                databaseInstanceIdRef.current !==
                  rematerializationSnapshot.currentInstanceId)
            ) {
              return null;
            }
            try {
              await rematerializeRemoteVfsStateIfNeeded();
            } catch (rematerializationError) {
              if (
                isVfsTransientInstanceSwitchError(rematerializationError)
              ) {
                return null;
              }
              console.warn(
                'VFS rematerialization callback failed; continuing with sync fallback state reset:',
                formatEpochTrace(
                  rematerializationSnapshot,
                  getInstanceChangeSnapshot()
                ),
                rematerializationError
              );
            }
            return null;
          }
        },
        blob: {
          baseUrl: effectiveBaseUrl,
          apiPrefix: effectiveApiPrefix,
          getOrganizationId: getActiveOrganizationId,
          onOperationResult: logBlobFlushOperationTelemetry
        },
        saveState: async (state) => {
          await saveVfsOrchestratorState(user.id, orchestratorClientId, state);
        },
        loadState: async () => {
          return loadVfsOrchestratorState(user.id, orchestratorClientId);
        }
      });
      await nextOrchestrator.hydrateFromPersistence();
      if (initializeRunIdRef.current !== runId) {
        return;
      }

      const itemKeyStore = createItemKeyStore();
      const userKeyProvider = createUserKeyProvider(() => user);
      const recipientPublicKeyResolver = createRecipientPublicKeyResolver();

      const bundle = createVfsSecurePipelineBundle({
        userKeyProvider,
        itemKeyStore,
        recipientPublicKeyResolver,
        ensureUserKeys: async (): Promise<void> => {
          await ensureVfsKeys();
        }
      });

      const facade = bundle.createFacade(nextOrchestrator, {
        relationKind: 'file'
      });

      setOrchestrator(nextOrchestrator);
      setSecureFacade(facade);
      setKeyManager(bundle.keyManager);
      setVfsItemSyncRuntime({
        currentInstanceId: runtimeSnapshot.currentInstanceId,
        instanceEpoch: runtimeSnapshot.instanceEpoch,
        orchestrator: nextOrchestrator,
        secureFacade: facade
      });
    } catch (err) {
      if (initializeRunIdRef.current !== runId) {
        return;
      }
      const initError =
        err instanceof Error ? err : new Error('Failed to initialize VFS');
      setError(initError);
      console.error('VFS orchestrator initialization failed:', err);
      resetRuntime();
    } finally {
      if (initializeRunIdRef.current === runId) {
        setIsInitializing(false);
      }
    }
  }, [
    user,
    isAuthenticated,
    runtimeSnapshot.currentInstanceId,
    runtimeSnapshot.instanceEpoch,
    effectiveBaseUrl,
    effectiveApiPrefix,
    hasDatabaseContext,
    currentDatabaseInstanceId,
    isDatabaseReady,
    logBlobFlushOperationTelemetry,
    resetRuntime
  ]);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  useFlushWhenOrganizationReady({
    orchestrator,
    isAuthenticated
  });

  useEffect(() => {
    if (!orchestrator || !isAuthenticated) {
      return;
    }

    const flushOnOnline = () => {
      const onlineFlushSnapshot = getInstanceChangeSnapshot();
      void orchestrator.flushAll().catch((err) => {
        if (isVfsTransientInstanceSwitchError(err)) {
          return;
        }
        console.warn(
          'VFS flush on reconnect failed:',
          formatEpochTrace(onlineFlushSnapshot, getInstanceChangeSnapshot()),
          err
        );
      });
    };

    window.addEventListener('online', flushOnOnline);
    return () => {
      window.removeEventListener('online', flushOnOnline);
    };
  }, [orchestrator, isAuthenticated]);

  useEffect(() => {
    return () => {
      initializeRunIdRef.current += 1;
      resetRuntime();
    };
  }, [resetRuntime]);

  return {
    orchestrator,
    secureFacade,
    keyManager,
    isInitializing,
    error,
    initialize
  };
}
