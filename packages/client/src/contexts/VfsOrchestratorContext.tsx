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
  type VfsKeySetupPayload,
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
import { ensureVfsKeys } from '@/hooks/vfs';
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

function normalizeBasePath(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (trimmed.length === 0) {
    return '';
  }

  try {
    const parsed = new URL(trimmed);
    return parsed.pathname.endsWith('/')
      ? parsed.pathname.slice(0, -1)
      : parsed.pathname;
  } catch {
    return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
  }
}

function resolveTransportApiPrefix(baseUrl: string, apiPrefix: string): string {
  const normalizedPrefix = normalizeApiPrefix(apiPrefix);
  if (normalizedPrefix.length === 0) {
    return '';
  }

  const normalizedBasePath = normalizeBasePath(baseUrl);
  if (normalizedBasePath.endsWith(normalizedPrefix)) {
    return '';
  }

  return normalizedPrefix;
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
  /** API prefix for routes (defaults to '/v1') */
  apiPrefix?: string;
}

export function VfsOrchestratorProvider({
  children,
  baseUrl,
  apiPrefix = '/v1'
}: VfsOrchestratorProviderProps) {
  const orchestratorClientId = 'client';
  const { user, isAuthenticated } = useAuth();
  const [orchestrator, setOrchestrator] = useState<VfsWriteOrchestrator | null>(
    null
  );
  const [secureFacade, setSecureFacade] =
    useState<VfsSecureOrchestratorFacade | null>(null);
  const [keyManager, setKeyManager] = useState<VfsKeyManager | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const effectiveBaseUrl = baseUrl ?? import.meta.env.VITE_API_URL ?? '';
  const effectiveApiPrefix = resolveTransportApiPrefix(
    effectiveBaseUrl,
    apiPrefix
  );

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
    if (!user || !isAuthenticated) {
      setOrchestrator(null);
      setSecureFacade(null);
      setKeyManager(null);
      setVfsItemSyncRuntime(null);
      return;
    }

    setIsInitializing(true);
    setError(null);

    try {
      const newOrchestrator = new VfsWriteOrchestrator(user.id, 'client', {
        crdt: {
          transportOptions: {
            baseUrl: effectiveBaseUrl,
            apiPrefix: effectiveApiPrefix
          },
          onRematerializationRequired: async () => {
            try {
              await rematerializeRemoteVfsStateIfNeeded();
            } catch (rematerializationError) {
              console.warn(
                'VFS rematerialization callback failed; continuing with sync fallback state reset:',
                rematerializationError
              );
            }
            return null;
          }
        },
        blob: {
          baseUrl: effectiveBaseUrl,
          apiPrefix: effectiveApiPrefix,
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

      const itemKeyStore = createItemKeyStore();
      const userKeyProvider = createUserKeyProvider(() => user);
      const recipientPublicKeyResolver = createRecipientPublicKeyResolver();

      const bundle = createVfsSecurePipelineBundle({
        userKeyProvider,
        itemKeyStore,
        recipientPublicKeyResolver,
        createKeySetupPayload: async (): Promise<VfsKeySetupPayload> => {
          await ensureVfsKeys();
          return {
            publicEncryptionKey: '',
            publicSigningKey: '',
            encryptedPrivateKeys: '',
            argon2Salt: ''
          };
        }
      });

      const facade = bundle.createFacade(newOrchestrator, {
        relationKind: 'file'
      });

      setOrchestrator(newOrchestrator);
      setSecureFacade(facade);
      setKeyManager(bundle.keyManager);
      setVfsItemSyncRuntime({
        orchestrator: newOrchestrator,
        secureFacade: facade
      });
      void newOrchestrator.flushAll().catch((flushErr) => {
        console.warn('Initial VFS orchestrator flush failed:', flushErr);
      });
    } catch (err) {
      const initError =
        err instanceof Error ? err : new Error('Failed to initialize VFS');
      setError(initError);
      console.error('VFS orchestrator initialization failed:', err);
      setVfsItemSyncRuntime(null);
    } finally {
      setIsInitializing(false);
    }
  }, [
    user,
    isAuthenticated,
    effectiveBaseUrl,
    effectiveApiPrefix,
    logBlobFlushOperationTelemetry
  ]);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  useEffect(() => {
    if (!orchestrator || !isAuthenticated) {
      return;
    }

    const flushOnOnline = () => {
      void orchestrator.flushAll().catch((err) => {
        console.warn('VFS flush on reconnect failed:', err);
      });
    };

    window.addEventListener('online', flushOnOnline);
    return () => {
      window.removeEventListener('online', flushOnOnline);
    };
  }, [orchestrator, isAuthenticated]);

  useEffect(() => {
    return () => {
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
