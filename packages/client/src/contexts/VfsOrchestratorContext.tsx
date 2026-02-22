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
} from '@tearleads/api-client';
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
import { createRecipientPublicKeyResolver } from '@/db/vfsRecipientKeyResolver';
import { createUserKeyProvider } from '@/db/vfsUserKeyProvider';
import { ensureVfsKeys } from '@/hooks/vfs';
import { useAuth } from './AuthContext';

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
      return;
    }

    setIsInitializing(true);
    setError(null);

    try {
      // Create the orchestrator
      const newOrchestrator = new VfsWriteOrchestrator(user.id, 'client', {
        crdt: {
          transportOptions: {
            baseUrl: effectiveBaseUrl,
            apiPrefix
          }
        },
        blob: {
          baseUrl: effectiveBaseUrl,
          apiPrefix,
          onOperationResult: logBlobFlushOperationTelemetry
        }
      });

      // Create adapters
      const itemKeyStore = createItemKeyStore();
      const userKeyProvider = createUserKeyProvider(() => user);
      const recipientPublicKeyResolver = createRecipientPublicKeyResolver();

      // Create the secure pipeline bundle
      const bundle = createVfsSecurePipelineBundle({
        userKeyProvider,
        itemKeyStore,
        recipientPublicKeyResolver,
        createKeySetupPayload: async (): Promise<VfsKeySetupPayload> => {
          // Ensure VFS keys are set up (this handles key generation/fetching).
          // The ensureVfsKeys() function handles the full key setup flow including
          // server registration. This callback is used by VfsKeyManager for its
          // internal state tracking, but the actual crypto keys are managed by
          // the useVfsKeys hook and stored on the server during onboarding.
          // The empty strings are intentional placeholders as the key manager
          // doesn't need the actual values - it defers to userKeyProvider.
          await ensureVfsKeys();
          return {
            publicEncryptionKey: '',
            publicSigningKey: '',
            encryptedPrivateKeys: '',
            argon2Salt: ''
          };
        }
      });

      // Create the secure facade
      const facade = bundle.createFacade(newOrchestrator, {
        relationKind: 'file'
      });

      setOrchestrator(newOrchestrator);
      setSecureFacade(facade);
      setKeyManager(bundle.keyManager);
    } catch (err) {
      const initError =
        err instanceof Error ? err : new Error('Failed to initialize VFS');
      setError(initError);
      console.error('VFS orchestrator initialization failed:', err);
    } finally {
      setIsInitializing(false);
    }
  }, [
    user,
    isAuthenticated,
    effectiveBaseUrl,
    apiPrefix,
    logBlobFlushOperationTelemetry
  ]);

  // Initialize when user becomes authenticated
  useEffect(() => {
    void initialize();
  }, [initialize]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      setOrchestrator(null);
      setSecureFacade(null);
      setKeyManager(null);
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
