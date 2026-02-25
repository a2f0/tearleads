import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VfsOrchestratorProvider } from './VfsOrchestratorContext';

const mockUser = {
  id: 'user-123',
  email: 'test@example.com',
  name: 'Test User'
};

const mockUseAuth = vi.fn();
const mockCreateFacade = vi.fn(() => ({ mockFacade: true }));
const mockCreateVfsSecurePipelineBundle = vi.fn(() => ({
  keyManager: { createItemKey: vi.fn() },
  createFacade: mockCreateFacade
}));
const mockLoadVfsOrchestratorState = vi.fn();
const mockSaveVfsOrchestratorState = vi.fn();
const mockRematerializeRemoteVfsStateIfNeeded = vi
  .fn()
  .mockResolvedValue(false);

vi.mock('@tearleads/api-client', () => {
  class MockVfsWriteOrchestrator {
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
  }

  return {
    createVfsSecurePipelineBundle: (...args: unknown[]) =>
      mockCreateVfsSecurePipelineBundle(...args),
    VfsWriteOrchestrator: MockVfsWriteOrchestrator
  };
});

vi.mock('@/db', () => ({
  isDatabaseInitialized: () => true,
  getDatabase: () => ({ insert: vi.fn() })
}));

vi.mock('@/db/analytics', () => ({
  logEvent: vi.fn().mockResolvedValue(undefined)
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

vi.mock('@/lib/vfsRematerialization', () => ({
  rematerializeRemoteVfsStateIfNeeded: (...args: unknown[]) =>
    mockRematerializeRemoteVfsStateIfNeeded(...args)
}));

vi.mock('./AuthContext', () => ({
  useAuth: () => mockUseAuth()
}));

describe('VfsOrchestratorContext persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({
      user: mockUser,
      isAuthenticated: true
    });
    mockLoadVfsOrchestratorState.mockResolvedValue(null);
    mockSaveVfsOrchestratorState.mockResolvedValue(undefined);
    mockRematerializeRemoteVfsStateIfNeeded.mockResolvedValue(false);
  });

  it('hydrates orchestrator state from sqlite persistence', async () => {
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
        loadState?: () => Promise<unknown>;
      };
      lastInstance: {
        hydrateFromPersistence: ReturnType<typeof vi.fn>;
      } | null;
    };

    const hydrateFromPersistence =
      MockVfsWriteOrchestrator.lastInstance?.hydrateFromPersistence;
    if (!hydrateFromPersistence) {
      throw new Error('Expected hydrateFromPersistence on orchestrator');
    }
    expect(hydrateFromPersistence).toHaveBeenCalledTimes(1);

    const loadState = MockVfsWriteOrchestrator.lastOptions?.loadState;
    if (!loadState) {
      throw new Error('Expected loadState callback on orchestrator options');
    }
    await loadState();
    expect(mockLoadVfsOrchestratorState).toHaveBeenCalledWith(
      mockUser.id,
      'client'
    );
  });

  it('wires saveState callback to sqlite persistence helper', async () => {
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
        saveState?: (state: { crdt: null; blob: null }) => Promise<void>;
      };
    };

    const saveState = MockVfsWriteOrchestrator.lastOptions?.saveState;
    if (!saveState) {
      throw new Error('Expected saveState callback on orchestrator options');
    }
    const persistedState = { crdt: null, blob: null };
    await saveState(persistedState);
    expect(mockSaveVfsOrchestratorState).toHaveBeenCalledWith(
      mockUser.id,
      'client',
      persistedState
    );
  });

  it('flushes orchestrator when browser returns online', async () => {
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
      lastInstance: {
        flushAll: ReturnType<typeof vi.fn>;
      } | null;
    };

    const flushAll = MockVfsWriteOrchestrator.lastInstance?.flushAll;
    if (!flushAll) {
      throw new Error('Expected orchestrator instance flushAll');
    }
    flushAll.mockClear();

    window.dispatchEvent(new Event('online'));
    await waitFor(() => {
      expect(flushAll).toHaveBeenCalledTimes(1);
    });
  });

  it('wires CRDT rematerialization callback to bootstrap helper', async () => {
    render(
      <VfsOrchestratorProvider>
        <div>Test</div>
      </VfsOrchestratorProvider>
    );

    await waitFor(() => {
      expect(mockCreateFacade).toHaveBeenCalled();
    });

    const apiClientModule = await import('@tearleads/api-client');
    const lastOptions = Reflect.get(apiClientModule.VfsWriteOrchestrator, 'lastOptions');
    const onRematerializationRequired =
      typeof lastOptions === 'object' &&
      lastOptions !== null &&
      'crdt' in lastOptions &&
      typeof lastOptions.crdt === 'object' &&
      lastOptions.crdt !== null &&
      'onRematerializationRequired' in lastOptions.crdt
        ? lastOptions.crdt.onRematerializationRequired
        : undefined;
    expect(typeof onRematerializationRequired).toBe('function');
    if (!onRematerializationRequired) {
      throw new Error('Expected CRDT onRematerializationRequired callback');
    }

    await expect(
      onRematerializationRequired({
        userId: mockUser.id,
        clientId: 'client',
        attempt: 1,
        error: {
          name: 'VfsCrdtRematerializationRequiredError',
          message: 'CRDT feed cursor requires re-materialization',
          code: 'crdt_rematerialization_required',
          requestedCursor: 'cursor-requested',
          oldestAvailableCursor: 'cursor-oldest'
        }
      })
    ).resolves.toBeNull();
    expect(mockRematerializeRemoteVfsStateIfNeeded).toHaveBeenCalledTimes(1);
  });
});
