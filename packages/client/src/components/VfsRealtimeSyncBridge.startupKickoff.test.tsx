import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mockGetActiveOrganizationId,
  mockHydrateLocalReadModelFromRemoteFeeds,
  mockUseSSE,
  mockUseVfsOrchestratorInstance,
  orgChangeListeners,
  resetVfsRealtimeSyncBridgeTestMocks
} from './VfsRealtimeSyncBridge.testSetup';
import { VfsRealtimeSyncBridge } from './VfsRealtimeSyncBridge';

describe('VfsRealtimeSyncBridge startup kickoff', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetVfsRealtimeSyncBridgeTestMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('kicks off sync on mount when an active organization is available', async () => {
    const connect = vi.fn();
    const syncCrdt = vi.fn().mockResolvedValue(undefined);
    mockUseSSE.mockReturnValue({
      connect,
      lastMessage: null
    });
    mockGetActiveOrganizationId.mockReturnValue('org-1');
    mockUseVfsOrchestratorInstance.mockReturnValue({
      crdt: {
        listChangedContainers: vi.fn(() => ({
          items: [],
          hasMore: false,
          nextCursor: null
        }))
      },
      syncCrdt
    });

    render(<VfsRealtimeSyncBridge />);
    await vi.advanceTimersByTimeAsync(200);

    expect(syncCrdt).toHaveBeenCalledTimes(1);
    expect(mockHydrateLocalReadModelFromRemoteFeeds).toHaveBeenCalledTimes(1);
  });

  it('kicks off sync when organization becomes available after mount', async () => {
    const connect = vi.fn();
    const syncCrdt = vi.fn().mockResolvedValue(undefined);
    mockUseSSE.mockReturnValue({
      connect,
      lastMessage: null
    });
    mockUseVfsOrchestratorInstance.mockReturnValue({
      crdt: {
        listChangedContainers: vi.fn(() => ({
          items: [],
          hasMore: false,
          nextCursor: null
        }))
      },
      syncCrdt
    });

    render(<VfsRealtimeSyncBridge />);
    await vi.advanceTimersByTimeAsync(200);
    expect(syncCrdt).not.toHaveBeenCalled();

    mockGetActiveOrganizationId.mockReturnValue('org-1');
    for (const listener of orgChangeListeners) {
      listener();
    }

    await vi.advanceTimersByTimeAsync(200);
    expect(syncCrdt).toHaveBeenCalledTimes(1);
    expect(mockHydrateLocalReadModelFromRemoteFeeds).toHaveBeenCalledTimes(1);
  });
});
