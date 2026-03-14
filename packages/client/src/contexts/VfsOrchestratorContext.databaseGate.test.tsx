import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emitInstanceChange, resetInstanceChangeState } from '@/hooks/app';
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
const mockIsVfsRuntimeDatabaseReady = vi.fn(() => true);
const mockRematerializeRemoteVfsStateIfNeeded = vi
  .fn()
  .mockResolvedValue(false);

interface MockVfsWriteOrchestratorClass {
  constructorCalls: number;
  lastOptions?: {
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
    static constructorCalls = 0;
    static lastOptions: unknown;
    static lastInstance: MockVfsWriteOrchestrator | null = null;

    constructor(_userId: string, _clientId: string, options: unknown) {
      MockVfsWriteOrchestrator.constructorCalls += 1;
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

vi.mock('@/lib/vfsRuntimeDatabaseGate', () => ({
  isVfsRuntimeDatabaseReady: (...args: unknown[]) =>
    mockIsVfsRuntimeDatabaseReady(...args)
}));

vi.mock('@/lib/vfsRematerialization', () => ({
  rematerializeRemoteVfsStateIfNeeded: (...args: unknown[]) =>
    mockRematerializeRemoteVfsStateIfNeeded(...args)
}));

vi.mock('./AuthContext', () => ({
  useAuth: () => mockUseAuth()
}));

describe('VfsOrchestratorContext database gate', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    resetInstanceChangeState();
    emitInstanceChange('instance-1');
    mockUseAuth.mockReturnValue({
      user: mockUser,
      isAuthenticated: true
    });
    mockLoadVfsOrchestratorState.mockResolvedValue(null);
    mockSaveVfsOrchestratorState.mockResolvedValue(undefined);
    mockIsVfsRuntimeDatabaseReady.mockReturnValue(true);
    mockRematerializeRemoteVfsStateIfNeeded.mockResolvedValue(false);

    const mockVfsWriteOrchestrator = await getMockVfsWriteOrchestratorClass();
    mockVfsWriteOrchestrator.constructorCalls = 0;
    mockVfsWriteOrchestrator.lastOptions = undefined;
    mockVfsWriteOrchestrator.lastInstance = null;
  });

  it('waits for the database readiness gate before initializing', async () => {
    mockIsVfsRuntimeDatabaseReady.mockReturnValue(false);

    const { rerender } = render(
      <VfsOrchestratorProvider>
        <div>Test</div>
      </VfsOrchestratorProvider>
    );

    await Promise.resolve();
    await Promise.resolve();
    expect(mockCreateFacade).not.toHaveBeenCalled();

    mockIsVfsRuntimeDatabaseReady.mockReturnValue(true);
    rerender(
      <VfsOrchestratorProvider>
        <div>Test</div>
      </VfsOrchestratorProvider>
    );

    await waitFor(() => {
      expect(mockCreateFacade).toHaveBeenCalledTimes(1);
    });
  });

  it('skips stale rematerialization callbacks after the database gate closes', async () => {
    const { rerender } = render(
      <VfsOrchestratorProvider>
        <div>Test</div>
      </VfsOrchestratorProvider>
    );

    await waitFor(() => {
      expect(mockCreateFacade).toHaveBeenCalledTimes(1);
    });

    const mockVfsWriteOrchestrator = await getMockVfsWriteOrchestratorClass();
    const onRematerializationRequired =
      mockVfsWriteOrchestrator.lastOptions?.crdt?.onRematerializationRequired;
    if (!onRematerializationRequired) {
      throw new Error('Expected CRDT onRematerializationRequired callback');
    }

    mockIsVfsRuntimeDatabaseReady.mockReturnValue(false);
    rerender(
      <VfsOrchestratorProvider>
        <div>Test</div>
      </VfsOrchestratorProvider>
    );
    await Promise.resolve();
    await Promise.resolve();

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

    expect(mockRematerializeRemoteVfsStateIfNeeded).not.toHaveBeenCalled();
  });
});
