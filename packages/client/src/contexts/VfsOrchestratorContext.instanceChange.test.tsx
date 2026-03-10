import { act, render, waitFor } from '@testing-library/react';
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

interface MockVfsWriteOrchestratorClass {
  constructorCalls: number;
  lastOptions?: {
    crdt?: {
      transportOptions?: { apiPrefix?: string };
    };
    blob?: { apiPrefix?: string };
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

vi.mock('@tearleads/api-client/clientEntry', async () => {
  const actual = await vi.importActual<
    typeof import('@tearleads/api-client/clientEntry')
  >('@tearleads/api-client/clientEntry');
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
    ...actual,
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
  rematerializeRemoteVfsStateIfNeeded: vi.fn().mockResolvedValue(false)
}));

vi.mock('./AuthContext', () => ({
  useAuth: () => mockUseAuth()
}));

describe('VfsOrchestratorContext instance change', () => {
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

    const mockVfsWriteOrchestrator = await getMockVfsWriteOrchestratorClass();
    mockVfsWriteOrchestrator.constructorCalls = 0;
    mockVfsWriteOrchestrator.lastOptions = undefined;
    mockVfsWriteOrchestrator.lastInstance = null;
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

    const mockVfsWriteOrchestrator = await getMockVfsWriteOrchestratorClass();
    expect(
      mockVfsWriteOrchestrator.lastOptions?.crdt?.transportOptions?.apiPrefix
    ).toBe('');
    expect(mockVfsWriteOrchestrator.lastOptions?.blob?.apiPrefix).toBe('');
  });

  it('reinitializes the orchestrator when the active instance changes', async () => {
    render(
      <VfsOrchestratorProvider>
        <div>Test</div>
      </VfsOrchestratorProvider>
    );

    await waitFor(() => {
      expect(mockCreateFacade).toHaveBeenCalledTimes(1);
    });

    const mockVfsWriteOrchestrator = await getMockVfsWriteOrchestratorClass();
    expect(mockVfsWriteOrchestrator.constructorCalls).toBe(1);

    await act(async () => {
      emitInstanceChange('instance-2');
    });

    await waitFor(() => {
      expect(mockVfsWriteOrchestrator.constructorCalls).toBe(2);
    });
  });
});
