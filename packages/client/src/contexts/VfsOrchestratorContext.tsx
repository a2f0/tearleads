import type {
  VfsKeyManager,
  VfsSecureOrchestratorFacade,
  VfsWriteOrchestrator
} from '@tearleads/api-client/clientEntry';
import type { ReactNode } from 'react';
import { createContext, useContext, useMemo } from 'react';
import { useVfsOrchestratorRuntime } from './useVfsOrchestratorRuntime';

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
  const {
    orchestrator,
    secureFacade,
    keyManager,
    isInitializing,
    error,
    initialize
  } = useVfsOrchestratorRuntime({
    baseUrl,
    apiPrefix
  });

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
