import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useVfsKeyManager,
  useVfsOrchestrator,
  useVfsOrchestratorInstance,
  useVfsSecureFacade,
  VfsOrchestratorProvider
} from './VfsOrchestratorContext';

const mockUser = {
  id: 'user-123',
  email: 'test@example.com',
  name: 'Test User'
};

const mockUseAuth = vi.fn();
const mockLogEvent = vi.fn().mockResolvedValue(undefined);
const mockIsDatabaseInitialized = vi.fn(() => true);
const mockGetDatabase = vi.fn(() => ({ insert: vi.fn() }));
const mockKeyManager = {
  createItemKey: vi.fn(),
  wrapItemKeyForShare: vi.fn(),
  rotateItemKeyEpoch: vi.fn()
};

const mockCreateFacade = vi.fn(() => ({ mockFacade: true }));
const mockCreateVfsSecurePipelineBundle = vi.fn(() => ({
  keyManager: mockKeyManager,
  createFacade: mockCreateFacade
}));
const mockLoadVfsOrchestratorState = vi.fn();
const mockSaveVfsOrchestratorState = vi.fn();

// Mock dependencies
vi.mock('@tearleads/api-client', () => {
  const MockVfsWriteOrchestrator = class {
    mockOrchestrator = true;
    static lastOptions: unknown;
    static lastInstance: MockVfsWriteOrchestrator | null = null;
    constructor(_userId: string, _clientId: string, options: unknown) {
      MockVfsWriteOrchestrator.lastOptions = options;
      MockVfsWriteOrchestrator.lastInstance = this;
    }
    hydrateFromPersistence = vi.fn().mockResolvedValue(false);
    flushAll = vi.fn().mockResolvedValue({
      crdt: { pushed: 0, pulled: 0, remainingQueued: 0 },
      blob: { processed: 0, remainingQueued: 0 }
    });
  };
  return {
    createVfsSecurePipelineBundle: (...args: unknown[]) =>
      mockCreateVfsSecurePipelineBundle(...args),
    VfsWriteOrchestrator: MockVfsWriteOrchestrator
  };
});

vi.mock('@/db', () => ({
  isDatabaseInitialized: () => mockIsDatabaseInitialized(),
  getDatabase: () => mockGetDatabase()
}));

vi.mock('@/db/analytics', () => ({
  logEvent: (...args: unknown[]) => mockLogEvent(...args)
}));

vi.mock('@/db/vfsOrchestratorState', () => ({
  loadVfsOrchestratorState: (...args: unknown[]) =>
    mockLoadVfsOrchestratorState(...args),
  saveVfsOrchestratorState: (...args: unknown[]) =>
    mockSaveVfsOrchestratorState(...args)
}));

vi.mock('@/db/vfsItemKeys', () => ({
  createItemKeyStore: vi.fn(() => ({
    getItemKey: vi.fn(),
    setItemKey: vi.fn(),
    getLatestKeyEpoch: vi.fn()
  }))
}));

vi.mock('@/db/vfsRecipientKeyResolver', () => ({
  createRecipientPublicKeyResolver: vi.fn(() => ({
    resolvePublicKey: vi.fn()
  }))
}));

vi.mock('@/db/vfsUserKeyProvider', () => ({
  createUserKeyProvider: vi.fn(() => ({
    getUserKeyPair: vi.fn(),
    getUserId: vi.fn(),
    getPublicKeyId: vi.fn()
  }))
}));

vi.mock('@/hooks/vfs', () => ({
  ensureVfsKeys: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('./AuthContext', () => ({
  useAuth: () => mockUseAuth()
}));

describe('VfsOrchestratorContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock implementations
    mockCreateFacade.mockReturnValue({ mockFacade: true });
    mockCreateVfsSecurePipelineBundle.mockReturnValue({
      keyManager: mockKeyManager,
      createFacade: mockCreateFacade
    });
    // Default to authenticated user
    mockUseAuth.mockReturnValue({
      user: mockUser,
      isAuthenticated: true
    });
    mockIsDatabaseInitialized.mockReturnValue(true);
    mockGetDatabase.mockReturnValue({ insert: vi.fn() });
    mockLogEvent.mockResolvedValue(undefined);
    mockLoadVfsOrchestratorState.mockResolvedValue(null);
    mockSaveVfsOrchestratorState.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('VfsOrchestratorProvider', () => {
    it('provides orchestrator and facade when user is authenticated', async () => {
      let contextValue: ReturnType<typeof useVfsOrchestrator> | null = null;

      function TestConsumer() {
        contextValue = useVfsOrchestrator();
        return <div>Test</div>;
      }

      render(
        <VfsOrchestratorProvider>
          <TestConsumer />
        </VfsOrchestratorProvider>
      );

      await waitFor(() => {
        expect(contextValue?.isReady).toBe(true);
      });

      expect(contextValue?.orchestrator).not.toBeNull();
      expect(contextValue?.secureFacade).not.toBeNull();
      expect(contextValue?.keyManager).toBe(mockKeyManager);
      expect(contextValue?.isInitializing).toBe(false);
      expect(contextValue?.error).toBeNull();
    });

    it('nulls out orchestrator, facade, and keyManager on logout', async () => {
      let contextValue: ReturnType<typeof useVfsOrchestrator> | null = null;
      function TestConsumer() {
        contextValue = useVfsOrchestrator();
        return <div>Test</div>;
      }
      const { rerender } = render(
        <VfsOrchestratorProvider>
          <TestConsumer />
        </VfsOrchestratorProvider>
      );
      await waitFor(() => {
        expect(contextValue?.isReady).toBe(true);
      });
      expect(contextValue?.orchestrator).not.toBeNull();
      expect(contextValue?.secureFacade).not.toBeNull();
      expect(contextValue?.keyManager).toBe(mockKeyManager);
      mockUseAuth.mockReturnValue({ user: null, isAuthenticated: false });
      rerender(
        <VfsOrchestratorProvider>
          <TestConsumer />
        </VfsOrchestratorProvider>
      );
      await waitFor(() => {
        expect(contextValue?.orchestrator).toBeNull();
      });
      expect(contextValue?.secureFacade).toBeNull();
      expect(contextValue?.keyManager).toBeNull();
      expect(contextValue?.isReady).toBe(false);
    });

    it('does not initialize when user is not authenticated', async () => {
      mockUseAuth.mockReturnValue({
        user: null,
        isAuthenticated: false
      });

      let contextValue: ReturnType<typeof useVfsOrchestrator> | null = null;

      function TestConsumer() {
        contextValue = useVfsOrchestrator();
        return <div>Test</div>;
      }

      render(
        <VfsOrchestratorProvider>
          <TestConsumer />
        </VfsOrchestratorProvider>
      );

      await waitFor(() => {
        expect(contextValue?.isInitializing).toBe(false);
      });

      expect(contextValue?.orchestrator).toBeNull();
      expect(contextValue?.secureFacade).toBeNull();
      expect(contextValue?.keyManager).toBeNull();
      expect(contextValue?.isReady).toBe(false);
    });

    it('handles initialization errors gracefully', async () => {
      mockCreateVfsSecurePipelineBundle.mockImplementation(() => {
        throw new Error('Initialization failed');
      });

      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      let contextValue: ReturnType<typeof useVfsOrchestrator> | null = null;

      function TestConsumer() {
        contextValue = useVfsOrchestrator();
        return <div>Test</div>;
      }

      render(
        <VfsOrchestratorProvider>
          <TestConsumer />
        </VfsOrchestratorProvider>
      );

      await waitFor(() => {
        expect(contextValue?.error).not.toBeNull();
      });

      expect(contextValue?.error?.message).toBe('Initialization failed');
      expect(contextValue?.isReady).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });

    it('provides reinitialize function', async () => {
      let contextValue: ReturnType<typeof useVfsOrchestrator> | null = null;

      function TestConsumer() {
        contextValue = useVfsOrchestrator();
        return <div>Test</div>;
      }

      render(
        <VfsOrchestratorProvider>
          <TestConsumer />
        </VfsOrchestratorProvider>
      );

      await waitFor(() => {
        expect(contextValue?.isReady).toBe(true);
      });

      expect(typeof contextValue?.reinitialize).toBe('function');
    });

    it('wires blob flush telemetry callback for orchestrator operations', async () => {
      render(
        <VfsOrchestratorProvider>
          <div>Test</div>
        </VfsOrchestratorProvider>
      );

      await waitFor(() => {
        expect(mockCreateFacade).toHaveBeenCalled();
      });

      const apiClientModule = await import('@tearleads/api-client');
      const MockVfsWriteOrchestrator = apiClientModule.VfsWriteOrchestrator as {
        lastOptions?: {
          blob?: {
            onOperationResult?: (event: {
              operationKind:
                | 'stage'
                | 'attach'
                | 'abandon'
                | 'chunk'
                | 'commit';
              attempts: number;
              retryCount: number;
              success: boolean;
              failureClass?: 'http_status' | 'network' | 'unknown';
              statusCode?: number;
              retryable?: boolean;
            }) => Promise<void>;
          };
        };
      };

      const onOperationResult =
        MockVfsWriteOrchestrator.lastOptions?.blob?.onOperationResult;
      expect(typeof onOperationResult).toBe('function');
      if (!onOperationResult) {
        throw new Error('Expected blob onOperationResult callback');
      }

      await onOperationResult({
        operationKind: 'commit',
        attempts: 2,
        retryCount: 1,
        success: true
      });

      expect(mockLogEvent).toHaveBeenCalledWith(
        expect.anything(),
        'vfs_blob_flush_operation',
        0,
        true,
        expect.objectContaining({
          operationKind: 'commit',
          attempts: 2,
          retryCount: 1
        })
      );
    });

    it('does not duplicate /v1 prefix when baseUrl already includes it', async () => {
      render(
        <VfsOrchestratorProvider baseUrl="http://localhost:5001/v1">
          <div>Test</div>
        </VfsOrchestratorProvider>
      );

      await waitFor(() => {
        expect(mockCreateFacade).toHaveBeenCalled();
      });

      const apiClientModule = await import('@tearleads/api-client');
      const MockVfsWriteOrchestrator = apiClientModule.VfsWriteOrchestrator as {
        lastOptions?: {
          crdt?: {
            transportOptions?: { apiPrefix?: string };
          };
          blob?: { apiPrefix?: string };
        };
      };

      expect(
        MockVfsWriteOrchestrator.lastOptions?.crdt?.transportOptions?.apiPrefix
      ).toBe('');
      expect(MockVfsWriteOrchestrator.lastOptions?.blob?.apiPrefix).toBe('');
    });
  });

  describe('useVfsOrchestrator', () => {
    it('throws when used outside provider', () => {
      function TestComponent() {
        useVfsOrchestrator();
        return null;
      }

      expect(() => render(<TestComponent />)).toThrow(
        'useVfsOrchestrator must be used within VfsOrchestratorProvider'
      );
    });
  });

  describe('useVfsSecureFacade', () => {
    it('returns null when not ready', async () => {
      mockUseAuth.mockReturnValue({
        user: null,
        isAuthenticated: false
      });

      let facade: ReturnType<typeof useVfsSecureFacade> = null;

      function TestConsumer() {
        facade = useVfsSecureFacade();
        return <div>Test</div>;
      }

      render(
        <VfsOrchestratorProvider>
          <TestConsumer />
        </VfsOrchestratorProvider>
      );

      await waitFor(() => {
        expect(facade).toBeNull();
      });
    });

    it('returns facade when ready', async () => {
      let facade: ReturnType<typeof useVfsSecureFacade> = null;

      function TestConsumer() {
        facade = useVfsSecureFacade();
        return <div>Test</div>;
      }

      render(
        <VfsOrchestratorProvider>
          <TestConsumer />
        </VfsOrchestratorProvider>
      );

      await waitFor(() => {
        expect(facade).not.toBeNull();
      });
    });
  });

  describe('useVfsOrchestratorInstance', () => {
    it('returns null when not ready', async () => {
      mockUseAuth.mockReturnValue({
        user: null,
        isAuthenticated: false
      });

      let orchestrator: ReturnType<typeof useVfsOrchestratorInstance> = null;

      function TestConsumer() {
        orchestrator = useVfsOrchestratorInstance();
        return <div>Test</div>;
      }

      render(
        <VfsOrchestratorProvider>
          <TestConsumer />
        </VfsOrchestratorProvider>
      );

      await waitFor(() => {
        expect(orchestrator).toBeNull();
      });
    });

    it('returns orchestrator when ready', async () => {
      let orchestrator: ReturnType<typeof useVfsOrchestratorInstance> = null;

      function TestConsumer() {
        orchestrator = useVfsOrchestratorInstance();
        return <div>Test</div>;
      }

      render(
        <VfsOrchestratorProvider>
          <TestConsumer />
        </VfsOrchestratorProvider>
      );

      await waitFor(() => {
        expect(orchestrator).not.toBeNull();
      });
    });
  });

  describe('useVfsKeyManager', () => {
    it('returns null when provider is missing', () => {
      let keyManager: ReturnType<typeof useVfsKeyManager> = null;

      function TestConsumer() {
        keyManager = useVfsKeyManager();
        return <div>Test</div>;
      }

      render(<TestConsumer />);

      expect(keyManager).toBeNull();
    });

    it('returns keyManager when initialized', async () => {
      let keyManager: ReturnType<typeof useVfsKeyManager> = null;

      function TestConsumer() {
        keyManager = useVfsKeyManager();
        return <div>Test</div>;
      }

      render(
        <VfsOrchestratorProvider>
          <TestConsumer />
        </VfsOrchestratorProvider>
      );

      await waitFor(() => {
        expect(keyManager).toBe(mockKeyManager);
      });
    });
  });
});
