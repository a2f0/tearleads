import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emitInstanceChange, resetInstanceChangeState } from '@/hooks/app';
import {
  clearActiveOrganizationId,
  setActiveOrganizationId
} from '@/lib/orgStorage';
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

interface MockVfsWriteOrchestratorClass {
  lastOptions?: {
    loadState?: () => Promise<unknown>;
    saveState?: (state: { crdt: null; blob: null }) => Promise<void>;
    crdt?: {
      onRematerializationRequired?: (input: {
        userId: string;
        clientId: string;
        attempt: number;
        error: {
          name: string;
          message: string;
          code: string;
          requestedCursor: string;
          oldestAvailableCursor: string;
        };
      }) => Promise<null>;
    };
  };
  lastInstance: {
    hydrateFromPersistence: ReturnType<typeof vi.fn>;
    flushAll: ReturnType<typeof vi.fn>;
  } | null;
}

async function getMockVfsWriteOrchestratorClass(): Promise<MockVfsWriteOrchestratorClass> {
  const apiClientModule = await import('@tearleads/api-client/clientEntry');
  return apiClientModule.VfsWriteOrchestrator as MockVfsWriteOrchestratorClass;
}

vi.mock('@tearleads/api-client/clientEntry', () => {
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
  logEvent: vi.fn().mockResolvedValue(undefined),
  logApiEvent: vi.fn().mockResolvedValue(undefined)
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

vi.mock('@/hooks/vfs/useVfsKeys', () => ({
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
  beforeEach(async () => {
    vi.clearAllMocks();
    resetInstanceChangeState();
    emitInstanceChange('instance-1');
    const mockVfsWriteOrchestrator = await getMockVfsWriteOrchestratorClass();
    mockVfsWriteOrchestrator.lastOptions = undefined;
    mockVfsWriteOrchestrator.lastInstance = null;
    clearActiveOrganizationId();
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

    const mockVfsWriteOrchestrator = await getMockVfsWriteOrchestratorClass();

    const hydrateFromPersistence =
      mockVfsWriteOrchestrator.lastInstance?.hydrateFromPersistence;
    if (!hydrateFromPersistence) {
      throw new Error('Expected hydrateFromPersistence on orchestrator');
    }
    expect(hydrateFromPersistence).toHaveBeenCalledTimes(1);

    const loadState = mockVfsWriteOrchestrator.lastOptions?.loadState;
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

    const mockVfsWriteOrchestrator = await getMockVfsWriteOrchestratorClass();

    const saveState = mockVfsWriteOrchestrator.lastOptions?.saveState;
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
    setActiveOrganizationId('org-1');
    render(
      <VfsOrchestratorProvider>
        <div>Test</div>
      </VfsOrchestratorProvider>
    );

    await waitFor(() => {
      expect(mockCreateFacade).toHaveBeenCalled();
    });

    const mockVfsWriteOrchestrator = await getMockVfsWriteOrchestratorClass();
    const flushAll = mockVfsWriteOrchestrator.lastInstance?.flushAll;
    if (!flushAll) {
      throw new Error('Expected orchestrator instance flushAll');
    }
    flushAll.mockClear();

    window.dispatchEvent(new Event('online'));
    await waitFor(() => {
      expect(flushAll).toHaveBeenCalledTimes(1);
    });
  });

  it('waits for active organization before initial flush', async () => {
    render(
      <VfsOrchestratorProvider>
        <div>Test</div>
      </VfsOrchestratorProvider>
    );

    await waitFor(() => {
      expect(mockCreateFacade).toHaveBeenCalled();
    });

    const mockVfsWriteOrchestrator = await getMockVfsWriteOrchestratorClass();
    const flushAll = mockVfsWriteOrchestrator.lastInstance?.flushAll;
    if (!flushAll) {
      throw new Error('Expected orchestrator instance flushAll');
    }
    flushAll.mockClear();

    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(flushAll).not.toHaveBeenCalled();

    setActiveOrganizationId('org-1');
    await waitFor(() => {
      expect(flushAll).toHaveBeenCalledTimes(1);
    });
  });

  it('skips initial flush when active organization id is empty', async () => {
    setActiveOrganizationId('');

    render(
      <VfsOrchestratorProvider>
        <div>Test</div>
      </VfsOrchestratorProvider>
    );

    await waitFor(() => {
      expect(mockCreateFacade).toHaveBeenCalled();
    });

    const mockVfsWriteOrchestrator = await getMockVfsWriteOrchestratorClass();
    const flushAll = mockVfsWriteOrchestrator.lastInstance?.flushAll;
    if (!flushAll) {
      throw new Error('Expected orchestrator instance flushAll');
    }
    flushAll.mockClear();

    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(flushAll).not.toHaveBeenCalled();

    setActiveOrganizationId('org-1');
    await waitFor(() => {
      expect(flushAll).toHaveBeenCalledTimes(1);
    });
  });

  it.each([
    {
      label: 'unauthorized error',
      error: new Error('Unauthorized')
    },
    {
      label: 'wrapped unauthorized response status',
      error: { error: { response: { status: 401 } } }
    },
    {
      label: 'connect unauthenticated code',
      error: { name: 'ConnectError', code: 16, message: '[unknown] token' }
    },
    {
      label: 'database initialization race',
      error: new Error('Database not initialized')
    },
    {
      label: 'wrapped database initialization race',
      error: { cause: { code: 'database_not_initialized' } }
    }
  ])('suppresses initial flush warning for transient $label', async ({
    error
  }) => {
    setActiveOrganizationId('org-1');
    const consoleWarnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => {});

    render(
      <VfsOrchestratorProvider>
        <div>Test</div>
      </VfsOrchestratorProvider>
    );

    await waitFor(() => {
      expect(mockCreateFacade).toHaveBeenCalled();
    });

    const mockVfsWriteOrchestrator = await getMockVfsWriteOrchestratorClass();
    const flushAll = mockVfsWriteOrchestrator.lastInstance?.flushAll;
    if (!flushAll) {
      throw new Error('Expected orchestrator instance flushAll');
    }
    flushAll.mockClear();
    flushAll.mockRejectedValueOnce(error);

    setActiveOrganizationId('org-2');
    await waitFor(() => {
      expect(flushAll).toHaveBeenCalledTimes(1);
    });
    expect(consoleWarnSpy).not.toHaveBeenCalled();

    consoleWarnSpy.mockRestore();
  });

  it('keeps warning for non-transient initial flush errors', async () => {
    setActiveOrganizationId('org-1');
    const consoleWarnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => {});

    render(
      <VfsOrchestratorProvider>
        <div>Test</div>
      </VfsOrchestratorProvider>
    );

    await waitFor(() => {
      expect(mockCreateFacade).toHaveBeenCalled();
    });

    const mockVfsWriteOrchestrator = await getMockVfsWriteOrchestratorClass();
    const flushAll = mockVfsWriteOrchestrator.lastInstance?.flushAll;
    if (!flushAll) {
      throw new Error('Expected orchestrator instance flushAll');
    }
    flushAll.mockClear();
    flushAll.mockRejectedValueOnce(new Error('network down'));

    setActiveOrganizationId('org-3');
    await waitFor(() => {
      expect(flushAll).toHaveBeenCalledTimes(1);
    });
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      'Initial VFS orchestrator flush failed:',
      expect.stringContaining('instanceEpoch='),
      expect.any(Error)
    );

    consoleWarnSpy.mockRestore();
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

    const mockVfsWriteOrchestrator = await getMockVfsWriteOrchestratorClass();
    const lastOptions = mockVfsWriteOrchestrator.lastOptions;
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
