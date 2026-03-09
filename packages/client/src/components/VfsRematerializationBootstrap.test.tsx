import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VfsRematerializationBootstrap } from './VfsRematerializationBootstrap';

const mockUseAuth = vi.fn();
const mockUseVfsOrchestrator = vi.fn();
const mockRematerializeRemoteVfsStateIfNeeded = vi.fn();
const mockGetInstanceChangeSnapshot = vi.fn();

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => mockUseAuth()
}));

vi.mock('@/contexts/VfsOrchestratorContext', () => ({
  useVfsOrchestrator: () => mockUseVfsOrchestrator()
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
    mockUseAuth.mockReturnValue({ isAuthenticated: true });
    mockUseVfsOrchestrator.mockReturnValue({ isReady: true });
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
    mockUseAuth.mockReturnValue({ isAuthenticated: false });

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
    mockUseAuth.mockReturnValue({ isAuthenticated: false });
    rerender(<VfsRematerializationBootstrap />);

    // Advance past retry delay — should NOT trigger another call
    await vi.advanceTimersByTimeAsync(5_000);
    expect(mockRematerializeRemoteVfsStateIfNeeded).toHaveBeenCalledTimes(1);

    consoleWarnSpy.mockRestore();
  });

  it('retries rematerialization after a failed attempt', async () => {
    mockRematerializeRemoteVfsStateIfNeeded
      .mockRejectedValueOnce(new Error('bootstrap failed'))
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
});
