import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VfsRematerializationBootstrap } from './VfsRematerializationBootstrap';

const mockUseAuth = vi.fn();
const mockUseVfsOrchestrator = vi.fn();
const mockUseDatabaseContext = vi.fn();
const mockRematerializeRemoteVfsStateIfNeeded = vi.fn();
const mockGetInstanceChangeSnapshot = vi.fn();

const unauthorizedErrorCases: Array<{ label: string; error: unknown }> = [
  { label: 'string unauthorized', error: 'Unauthorized' },
  { label: 'Unauthorized', error: new Error('Unauthorized') },
  { label: 'API error: 401', error: new Error('API error: 401') },
  {
    label: 'wrapped unauthorized cause',
    error: { message: 'request failed', cause: new Error('Unauthorized') }
  },
  {
    label: 'nested response status 401',
    error: { error: { response: { status: 401 } } }
  },
  {
    label: 'connect unauthenticated numeric code',
    error: { name: 'ConnectError', code: 16, message: '[unknown] stale token' }
  },
  { label: 'status=401', error: { status: 401 } },
  { label: 'statusCode=401', error: { statusCode: 401 } },
  { label: 'code=401', error: { code: 401 } },
  {
    label: 'code=unauthenticated',
    error: { code: 'unauthenticated', message: 'token expired' }
  }
];

const retryableErrorCases: Array<{ label: string; error: unknown }> = [
  { label: 'Error instance', error: new Error('bootstrap failed') },
  { label: 'primitive number', error: 42 },
  { label: 'record with message', error: { name: 'BootstrapError' } }
];

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => mockUseAuth()
}));

vi.mock('@/contexts/VfsOrchestratorContext', () => ({
  useVfsOrchestrator: () => mockUseVfsOrchestrator()
}));

vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => mockUseDatabaseContext()
}));

vi.mock('@/lib/vfsRematerialization', () => ({
  rematerializeRemoteVfsStateIfNeeded: (...args: unknown[]) =>
    mockRematerializeRemoteVfsStateIfNeeded(...args)
}));

vi.mock('@/hooks/app/useInstanceChange', () => ({
  getInstanceChangeSnapshot: () => mockGetInstanceChangeSnapshot()
}));

describe('VfsRematerializationBootstrap', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({
      isAuthenticated: true,
      token: 'token-1',
      user: { id: 'user-1' }
    });
    mockUseVfsOrchestrator.mockReturnValue({ isReady: true });
    mockUseDatabaseContext.mockReturnValue({
      currentInstanceId: 'instance-1',
      db: { name: 'db-1' },
      isLoading: false,
      instances: [
        {
          id: 'instance-1',
          name: 'Primary',
          createdAt: 0,
          lastAccessedAt: 0,
          boundUserId: 'user-1'
        }
      ]
    });
    mockRematerializeRemoteVfsStateIfNeeded.mockResolvedValue(false);
    mockGetInstanceChangeSnapshot.mockReturnValue({
      currentInstanceId: 'instance-1',
      instanceEpoch: 1
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not trigger rematerialization when unauthenticated', async () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: false,
      token: null,
      user: null
    });

    render(<VfsRematerializationBootstrap />);

    expect(mockRematerializeRemoteVfsStateIfNeeded).not.toHaveBeenCalled();
  });

  it('does not trigger rematerialization without an auth token', async () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: true,
      token: null,
      user: { id: 'user-1' }
    });

    render(<VfsRematerializationBootstrap />);

    expect(mockRematerializeRemoteVfsStateIfNeeded).not.toHaveBeenCalled();
  });

  it('does not trigger rematerialization while the database is still loading', async () => {
    mockUseDatabaseContext.mockReturnValue({
      currentInstanceId: 'instance-1',
      db: null,
      isLoading: true,
      instances: [
        {
          id: 'instance-1',
          name: 'Primary',
          createdAt: 0,
          lastAccessedAt: 0,
          boundUserId: 'user-1'
        }
      ]
    });

    render(<VfsRematerializationBootstrap />);
    await Promise.resolve();
    await Promise.resolve();

    expect(mockRematerializeRemoteVfsStateIfNeeded).not.toHaveBeenCalled();
  });

  it('does not trigger rematerialization without an active database instance', async () => {
    mockUseDatabaseContext.mockReturnValue({
      currentInstanceId: null,
      db: { name: 'db-1' },
      isLoading: false,
      instances: []
    });

    render(<VfsRematerializationBootstrap />);
    await Promise.resolve();
    await Promise.resolve();

    expect(mockRematerializeRemoteVfsStateIfNeeded).not.toHaveBeenCalled();
  });

  it('skips rematerialization when the runtime snapshot points at another instance', async () => {
    mockGetInstanceChangeSnapshot.mockReturnValue({
      currentInstanceId: 'instance-2',
      instanceEpoch: 1
    });

    render(<VfsRematerializationBootstrap />);
    await Promise.resolve();
    await Promise.resolve();

    expect(mockRematerializeRemoteVfsStateIfNeeded).not.toHaveBeenCalled();
  });

  it('clears retry timer when auth goes false', async () => {
    mockRematerializeRemoteVfsStateIfNeeded.mockRejectedValueOnce(
      new Error('bootstrap failed')
    );
    const consoleWarnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => {});

    const { rerender } = render(<VfsRematerializationBootstrap />);
    await Promise.resolve();
    await Promise.resolve();

    expect(mockRematerializeRemoteVfsStateIfNeeded).toHaveBeenCalledTimes(1);

    // Simulate logout before retry fires
    mockUseAuth.mockReturnValue({
      isAuthenticated: false,
      token: null,
      user: null
    });
    rerender(<VfsRematerializationBootstrap />);

    // Advance past retry delay — should NOT trigger another call
    await vi.advanceTimersByTimeAsync(5_000);
    expect(mockRematerializeRemoteVfsStateIfNeeded).toHaveBeenCalledTimes(1);

    consoleWarnSpy.mockRestore();
  });

  it.each(
    retryableErrorCases
  )('retries rematerialization after failed attempt from $label', async ({
    error
  }) => {
    mockRematerializeRemoteVfsStateIfNeeded
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(false);
    const consoleWarnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => {});

    render(<VfsRematerializationBootstrap />);
    await Promise.resolve();
    await Promise.resolve();

    expect(mockRematerializeRemoteVfsStateIfNeeded).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(mockRematerializeRemoteVfsStateIfNeeded).toHaveBeenCalledTimes(2);

    consoleWarnSpy.mockRestore();
  });

  it.each(
    unauthorizedErrorCases
  )('suppresses $label failures and avoids retrying until auth recovers', async ({
    error
  }) => {
    mockRematerializeRemoteVfsStateIfNeeded.mockRejectedValueOnce(error);
    const consoleWarnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => {});

    render(<VfsRematerializationBootstrap />);
    expect(mockRematerializeRemoteVfsStateIfNeeded).toHaveBeenCalledTimes(1);
    expect(consoleWarnSpy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5_000);
    expect(mockRematerializeRemoteVfsStateIfNeeded).toHaveBeenCalledTimes(1);
    expect(consoleWarnSpy).not.toHaveBeenCalled();

    consoleWarnSpy.mockRestore();
  });

  it('suppresses "Database not initialized" warnings and retries', async () => {
    mockRematerializeRemoteVfsStateIfNeeded
      .mockRejectedValueOnce(new Error('Database not initialized'))
      .mockResolvedValueOnce(false);
    const consoleWarnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => {});

    render(<VfsRematerializationBootstrap />);
    expect(mockRematerializeRemoteVfsStateIfNeeded).toHaveBeenCalledTimes(1);
    expect(consoleWarnSpy).not.toHaveBeenCalled();

    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(2_001);
    expect(mockRematerializeRemoteVfsStateIfNeeded).toHaveBeenCalledTimes(2);
    expect(consoleWarnSpy).not.toHaveBeenCalled();

    consoleWarnSpy.mockRestore();
  });

  it('clears pending retry timer when readiness changes and reruns immediately', async () => {
    let isReady = true;
    mockUseVfsOrchestrator.mockImplementation(() => ({ isReady }));
    mockRematerializeRemoteVfsStateIfNeeded
      .mockRejectedValueOnce(new Error('bootstrap failed'))
      .mockResolvedValue(false);
    const consoleWarnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => {});

    const { rerender } = render(<VfsRematerializationBootstrap />);
    await Promise.resolve();
    await Promise.resolve();

    expect(mockRematerializeRemoteVfsStateIfNeeded).toHaveBeenCalledTimes(1);

    isReady = false;
    rerender(<VfsRematerializationBootstrap />);
    isReady = true;
    rerender(<VfsRematerializationBootstrap />);
    await Promise.resolve();
    await Promise.resolve();

    expect(mockRematerializeRemoteVfsStateIfNeeded).toHaveBeenCalledTimes(2);

    consoleWarnSpy.mockRestore();
  });

  it('reruns rematerialization when the active database instance changes', async () => {
    vi.useRealTimers();
    let currentInstanceId = 'instance-1';
    let db = { name: 'db-1' };
    let instances = [
      {
        id: 'instance-1',
        name: 'Primary',
        createdAt: 0,
        lastAccessedAt: 0,
        boundUserId: 'user-1'
      }
    ];
    mockUseDatabaseContext.mockImplementation(() => ({
      currentInstanceId,
      db,
      isLoading: false,
      instances
    }));

    const { rerender } = render(<VfsRematerializationBootstrap />);
    await waitFor(() => {
      expect(mockRematerializeRemoteVfsStateIfNeeded).toHaveBeenCalledTimes(1);
    });

    currentInstanceId = 'instance-2';
    db = { name: 'db-2' };
    instances = [
      {
        id: 'instance-2',
        name: 'Secondary',
        createdAt: 0,
        lastAccessedAt: 0,
        boundUserId: 'user-1'
      }
    ];
    mockGetInstanceChangeSnapshot.mockReturnValue({
      currentInstanceId,
      instanceEpoch: 2
    });

    rerender(<VfsRematerializationBootstrap />);
    await waitFor(() => {
      expect(mockRematerializeRemoteVfsStateIfNeeded).toHaveBeenCalledTimes(2);
    });
  });

  it('ignores failed rematerialization attempts from stale instance epochs', async () => {
    const consoleWarnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => {});
    let rejectRematerialization: ((reason?: unknown) => void) | null = null;
    mockRematerializeRemoteVfsStateIfNeeded.mockImplementationOnce(
      () =>
        new Promise<boolean>((_resolve, reject) => {
          rejectRematerialization = reject;
        })
    );

    render(<VfsRematerializationBootstrap />);
    await Promise.resolve();
    await Promise.resolve();
    expect(mockRematerializeRemoteVfsStateIfNeeded).toHaveBeenCalledTimes(1);

    mockGetInstanceChangeSnapshot.mockReturnValue({
      currentInstanceId: 'instance-2',
      instanceEpoch: 2
    });
    rejectRematerialization?.(new Error('stale epoch failure'));
    await Promise.resolve();
    await Promise.resolve();

    await vi.advanceTimersByTimeAsync(5_000);
    expect(mockRematerializeRemoteVfsStateIfNeeded).toHaveBeenCalledTimes(1);
    expect(consoleWarnSpy).not.toHaveBeenCalled();
    consoleWarnSpy.mockRestore();
  });

  it('ignores in-flight failures after auth transitions cancel bootstrap', async () => {
    const consoleWarnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => {});
    let rejectRematerialization: ((reason?: unknown) => void) | null = null;

    mockRematerializeRemoteVfsStateIfNeeded.mockImplementationOnce(
      () =>
        new Promise<boolean>((_resolve, reject) => {
          rejectRematerialization = reject;
        })
    );

    const { rerender } = render(<VfsRematerializationBootstrap />);
    await Promise.resolve();
    await Promise.resolve();
    expect(mockRematerializeRemoteVfsStateIfNeeded).toHaveBeenCalledTimes(1);

    mockUseAuth.mockReturnValue({
      isAuthenticated: false,
      token: null,
      user: null
    });
    rerender(<VfsRematerializationBootstrap />);

    rejectRematerialization?.(new Error('bootstrap failed after switch'));
    await Promise.resolve();
    await Promise.resolve();

    await vi.advanceTimersByTimeAsync(5_000);
    expect(mockRematerializeRemoteVfsStateIfNeeded).toHaveBeenCalledTimes(1);
    expect(consoleWarnSpy).not.toHaveBeenCalled();

    consoleWarnSpy.mockRestore();
  });

  it('ignores successful rematerialization attempts from stale instance epochs', async () => {
    let resolveRematerialization: ((value: boolean) => void) | null = null;
    mockRematerializeRemoteVfsStateIfNeeded.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          resolveRematerialization = resolve;
        })
    );

    render(<VfsRematerializationBootstrap />);
    await Promise.resolve();
    await Promise.resolve();
    expect(mockRematerializeRemoteVfsStateIfNeeded).toHaveBeenCalledTimes(1);

    mockGetInstanceChangeSnapshot.mockReturnValue({
      currentInstanceId: 'instance-2',
      instanceEpoch: 2
    });
    resolveRematerialization?.(false);
    await Promise.resolve();
    await Promise.resolve();

    await vi.advanceTimersByTimeAsync(5_000);
    expect(mockRematerializeRemoteVfsStateIfNeeded).toHaveBeenCalledTimes(1);
  });

  it('waits until the active instance is bound to the authenticated user', async () => {
    vi.useRealTimers();
    let instances = [
      {
        id: 'instance-1',
        name: 'Primary',
        createdAt: 0,
        lastAccessedAt: 0,
        boundUserId: null
      }
    ];
    mockUseDatabaseContext.mockImplementation(() => ({
      currentInstanceId: 'instance-1',
      db: { name: 'db-1' },
      isLoading: false,
      instances
    }));

    const { rerender } = render(<VfsRematerializationBootstrap />);

    await Promise.resolve();
    await Promise.resolve();
    expect(mockRematerializeRemoteVfsStateIfNeeded).not.toHaveBeenCalled();

    instances = [
      {
        id: 'instance-1',
        name: 'Primary',
        createdAt: 0,
        lastAccessedAt: 0,
        boundUserId: 'user-1'
      }
    ];
    rerender(<VfsRematerializationBootstrap />);

    await waitFor(() => {
      expect(mockRematerializeRemoteVfsStateIfNeeded).toHaveBeenCalledTimes(1);
    });
  });
});
