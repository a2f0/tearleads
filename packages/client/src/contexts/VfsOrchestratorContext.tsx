/**
 * VFS Write Orchestrator Context
 *
 * Provides the VfsWriteOrchestrator and VfsSecureOrchestratorFacade
 * throughout the application. Initializes with proper adapters for
 * key management and encryption.
 */
import {
  createVfsSecurePipelineBundle,
  type VfsKeyManager,
  type VfsSecureOrchestratorFacade,
  VfsWriteOrchestrator
} from '@tearleads/api-client/clientEntry';
import type { ReactNode } from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { getDatabase, isDatabaseInitialized } from '@/db';
import { logEvent } from '@/db/analytics';
import { createItemKeyStore } from '@/db/vfsItemKeys';
import {
  loadVfsOrchestratorState,
  saveVfsOrchestratorState
} from '@/db/vfsOrchestratorState';
import { createRecipientPublicKeyResolver } from '@/db/vfsRecipientKeyResolver';
import { createUserKeyProvider } from '@/db/vfsUserKeyProvider';
import {
  getInstanceChangeSnapshot,
  subscribeToInstanceChange,
  type InstanceChangeSnapshot
} from '@/hooks/app/useInstanceChange';
import { ensureVfsKeys } from '@/hooks/vfs';
import {
  getActiveOrganizationId,
  hasActiveOrganizationId,
  onOrgChange
} from '@/lib/orgStorage';
import { setVfsItemSyncRuntime } from '@/lib/vfsItemSyncWriter';
import { rematerializeRemoteVfsStateIfNeeded } from '@/lib/vfsRematerialization';
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

interface VfsOrchestratorContextValue {
  /** The underlying orchestrator for queue/flush operations */
  orchestrator: VfsWriteOrchestrator | null;
  /** The secure facade for encrypted operations */
  secureFacade: VfsSecureOrchestratorFacade | null;
  /** Runtime key manager for item-key provisioning and rotation */
  keyManager: VfsKeyManager | null;
  /** Whether the orchestrator is fully initialized and ready */
  isReady: boolean;
  /** Whether initialization is in progress */
  isInitializing: boolean;
  /** Any error that occurred during initialization */
  error: Error | null;
  /** Reinitialize the orchestrator (e.g., after logout/login) */
  reinitialize: () => Promise<void>;
}

const VfsOrchestratorContext =
  createContext<VfsOrchestratorContextValue | null>(null);

interface VfsOrchestratorProviderProps {
  children: ReactNode;
  /** Base URL for API calls (defaults to VITE_API_URL) */
  baseUrl?: string;
  /** Optional API prefix for routes (defaults to none) */
  apiPrefix?: string;
}

export function VfsOrchestratorProvider({
  children,
  baseUrl,
  apiPrefix = ''
}: VfsOrchestratorProviderProps) {
  const orchestratorClientId = 'client';
  const { user, isAuthenticated } = useAuth();
  const [runtimeSnapshot, setRuntimeSnapshot] = useState<InstanceChangeSnapshot>(
    () => getInstanceChangeSnapshot()
  );
  const [orchestrator, setOrchestrator] = useState<VfsWriteOrchestrator | null>(
    null
  );
  const [secureFacade, setSecureFacade] =
    useState<VfsSecureOrchestratorFacade | null>(null);
  const [keyManager, setKeyManager] = useState<VfsKeyManager | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const initializeRunIdRef = useRef(0);

  const effectiveBaseUrl = baseUrl ?? import.meta.env.VITE_API_URL ?? '';
  const effectiveApiPrefix = normalizeApiPrefix(apiPrefix);

  useEffect(() => {
    return subscribeToInstanceChange(() => {
      setRuntimeSnapshot(getInstanceChangeSnapshot());
    });
  }, []);

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
      runtimeSnapshot.currentInstanceId === null
    ) {
      resetRuntime();
      setIsInitializing(false);
      return;
    }

    resetRuntime();
    setIsInitializing(true);
    setError(null);

    try {
      const newOrchestrator = new VfsWriteOrchestrator(user.id, 'client', {
        crdt: {
          transportOptions: {
            baseUrl: effectiveBaseUrl,
            apiPrefix: effectiveApiPrefix,
            getOrganizationId: getActiveOrganizationId
          },
          onRematerializationRequired: async () => {
            const rematerializationSnapshot = getInstanceChangeSnapshot();
            try {
              await rematerializeRemoteVfsStateIfNeeded();
            } catch (rematerializationError) {
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
      await newOrchestrator.hydrateFromPersistence();
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

      const facade = bundle.createFacade(newOrchestrator, {
        relationKind: 'file'
      });

      setOrchestrator(newOrchestrator);
      setSecureFacade(facade);
      setKeyManager(bundle.keyManager);
      setVfsItemSyncRuntime({
        currentInstanceId: runtimeSnapshot.currentInstanceId,
        instanceEpoch: runtimeSnapshot.instanceEpoch,
        orchestrator: newOrchestrator,
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
      setOrchestrator(null);
      setSecureFacade(null);
      setKeyManager(null);
      setVfsItemSyncRuntime(null);
    };
  }, []);

  const contextValue = useMemo<VfsOrchestratorContextValue>(
    () => ({
      orchestrator,
      secureFacade,
      keyManager,
      isReady:
        orchestrator !== null &&
        secureFacade !== null &&
        keyManager !== null &&
        !isInitializing,
      isInitializing,
      error,
      reinitialize: initialize
    }),
    [orchestrator, secureFacade, keyManager, isInitializing, error, initialize]
  );

  return (
    <VfsOrchestratorContext.Provider value={contextValue}>
      {children}
    </VfsOrchestratorContext.Provider>
  );
}

/**
 * Hook to access the VFS orchestrator context.
 * Throws if used outside of VfsOrchestratorProvider.
 */
export function useVfsOrchestrator(): VfsOrchestratorContextValue {
  const context = useContext(VfsOrchestratorContext);
  if (!context) {
    throw new Error(
      'useVfsOrchestrator must be used within VfsOrchestratorProvider'
    );
  }
  return context;
}

/**
 * Hook to access the secure facade.
 * Returns null if not ready or if provider is not present.
 */
export function useVfsSecureFacade(): VfsSecureOrchestratorFacade | null {
  const context = useContext(VfsOrchestratorContext);
  if (!context || !context.isReady) {
    return null;
  }
  return context.secureFacade;
}

/**
 * Hook to access the key manager.
 * Returns null if provider is not present or key manager is not initialized.
 */
export function useVfsKeyManager(): VfsKeyManager | null {
  const context = useContext(VfsOrchestratorContext);
  if (!context) {
    return null;
  }
  return context.keyManager;
}

/**
 * Hook to access the orchestrator.
 * Returns null if not ready or if provider is not present.
 */
export function useVfsOrchestratorInstance(): VfsWriteOrchestrator | null {
  const context = useContext(VfsOrchestratorContext);
  if (!context || !context.isReady) {
    return null;
  }
  return context.orchestrator;
}
