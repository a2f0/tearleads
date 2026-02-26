import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VfsRematerializationBootstrap } from './VfsRematerializationBootstrap';

const mockUseAuth = vi.fn();
const mockUseVfsOrchestrator = vi.fn();
const mockRematerializeRemoteVfsStateIfNeeded = vi.fn();

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

describe('VfsRematerializationBootstrap', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({ isAuthenticated: true });
    mockUseVfsOrchestrator.mockReturnValue({ isReady: true });
    mockRematerializeRemoteVfsStateIfNeeded.mockResolvedValue(false);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls rematerialization once on mount when authenticated and ready', async () => {
    render(<VfsRematerializationBootstrap />);
    await Promise.resolve();
    await Promise.resolve();

    expect(mockRematerializeRemoteVfsStateIfNeeded).toHaveBeenCalledTimes(1);
  });

  it('does not call rematerialization when not authenticated', async () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: false });

    render(<VfsRematerializationBootstrap />);
    await Promise.resolve();
    await Promise.resolve();

    expect(mockRematerializeRemoteVfsStateIfNeeded).not.toHaveBeenCalled();
  });

  it('does not call rematerialization when not ready', async () => {
    mockUseVfsOrchestrator.mockReturnValue({ isReady: false });

    render(<VfsRematerializationBootstrap />);
    await Promise.resolve();
    await Promise.resolve();

    expect(mockRematerializeRemoteVfsStateIfNeeded).not.toHaveBeenCalled();
  });

  it('does not schedule a retry on success', async () => {
    mockRematerializeRemoteVfsStateIfNeeded.mockResolvedValueOnce(true);

    render(<VfsRematerializationBootstrap />);
    await Promise.resolve();
    await Promise.resolve();

    expect(mockRematerializeRemoteVfsStateIfNeeded).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(mockRematerializeRemoteVfsStateIfNeeded).toHaveBeenCalledTimes(1);
  });

  it('caps retry delay at MAX_RETRY_DELAY_MS', async () => {
    mockRematerializeRemoteVfsStateIfNeeded.mockRejectedValue(
      new Error('fail')
    );
    const consoleWarnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => {});

    render(<VfsRematerializationBootstrap />);

    // Exhaust retries: 2s -> 4s -> 8s -> 16s -> 32s -> 60s (capped)
    for (const delay of [2_000, 4_000, 8_000, 16_000, 32_000]) {
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(delay);
    }
    await Promise.resolve();
    await Promise.resolve();

    // Next retry should be at 60s cap, not 64s
    const callsBefore = mockRematerializeRemoteVfsStateIfNeeded.mock.calls
      .length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(
      mockRematerializeRemoteVfsStateIfNeeded.mock.calls.length
    ).toBeGreaterThan(callsBefore);

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
});
