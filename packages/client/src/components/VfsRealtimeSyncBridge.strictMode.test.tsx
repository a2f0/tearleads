import { render } from '@testing-library/react';
import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mockUseSSE,
  mockUseVfsOrchestratorInstance,
  resetVfsRealtimeSyncBridgeTestMocks
} from '@/components/VfsRealtimeSyncBridge.testSetup';
import { VfsRealtimeSyncBridge } from './VfsRealtimeSyncBridge';

describe('VfsRealtimeSyncBridge strict mode lifecycle', () => {
  beforeEach(() => {
    resetVfsRealtimeSyncBridgeTestMocks();
  });

  it('does not leak channel registrations across strict-mode remounts', () => {
    const activeChannels = new Set<string>();
    let maxActiveChannelCount = 0;
    const addChannels = vi.fn((channels: string[]) => {
      for (const channel of channels) {
        activeChannels.add(channel);
      }
      maxActiveChannelCount = Math.max(
        maxActiveChannelCount,
        activeChannels.size
      );
    });
    const removeChannels = vi.fn((channels: string[]) => {
      for (const channel of channels) {
        activeChannels.delete(channel);
      }
    });
    mockUseSSE.mockReturnValue({
      addChannels,
      removeChannels,
      lastMessage: null
    });
    mockUseVfsOrchestratorInstance.mockReturnValue({
      crdt: {
        listChangedContainers: vi.fn(() => ({
          items: [{ containerId: 'item-1' }],
          hasMore: false,
          nextCursor: null
        }))
      },
      syncCrdt: vi.fn()
    });

    const { unmount } = render(
      <StrictMode>
        <VfsRealtimeSyncBridge />
      </StrictMode>
    );

    expect(maxActiveChannelCount).toBe(1);
    expect(activeChannels.size).toBe(1);

    unmount();

    expect(activeChannels.size).toBe(0);
  });
});
