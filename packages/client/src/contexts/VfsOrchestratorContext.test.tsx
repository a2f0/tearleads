import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
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

const mockCreateFacade = vi.fn(() => ({ mockFacade: true }));
const mockCreateVfsSecurePipelineBundle = vi.fn(() => ({
  createFacade: mockCreateFacade
}));

// Mock dependencies
vi.mock('@tearleads/api-client', () => {
  const MockVfsWriteOrchestrator = class {
    mockOrchestrator = true;
  };
  return {
    createVfsSecurePipelineBundle: (...args: unknown[]) =>
      mockCreateVfsSecurePipelineBundle(...args),
    VfsWriteOrchestrator: MockVfsWriteOrchestrator
  };
});

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
      createFacade: mockCreateFacade
    });
    // Default to authenticated user
    mockUseAuth.mockReturnValue({
      user: mockUser,
      isAuthenticated: true
    });
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
      expect(contextValue?.isInitializing).toBe(false);
      expect(contextValue?.error).toBeNull();
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
});
