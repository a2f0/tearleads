import { beforeEach, describe, expect, it, vi } from 'vitest';

const broadcastMock = vi.fn();

vi.mock('./broadcast.js', () => ({
  broadcast: (...args: unknown[]) => broadcastMock(...args)
}));

import {
  parseVfsContainerIdFromSyncChannel,
  publishVfsContainerCursorBump
} from './vfsSyncChannels.js';

describe('vfsSyncChannels', () => {
  beforeEach(() => {
    broadcastMock.mockReset();
    broadcastMock.mockResolvedValue(undefined);
  });

  it('parses valid sync channels and rejects malformed ones', () => {
    expect(
      parseVfsContainerIdFromSyncChannel(
        'vfs:container:00000000-0000-0000-0000-000000000010:sync'
      )
    ).toBe('00000000-0000-0000-0000-000000000010');

    expect(parseVfsContainerIdFromSyncChannel('vfs:container:bad')).toBeNull();
    expect(parseVfsContainerIdFromSyncChannel('invalid-prefix')).toBeNull();
    expect(
      parseVfsContainerIdFromSyncChannel('vfs:container:   :sync')
    ).toBeNull();
  });

  it('publishes cursor bump notifications to the container sync channel', async () => {
    const payload = {
      containerId: '00000000-0000-0000-0000-000000000010',
      actorId: '00000000-0000-0000-0000-000000000001',
      sourceClientId: 'desktop',
      changedAt: '2026-03-12T00:00:00.000Z',
      changeId: '00000000-0000-0000-0000-000000000011'
    };

    await publishVfsContainerCursorBump(payload);

    expect(broadcastMock).toHaveBeenCalledTimes(1);
    expect(broadcastMock).toHaveBeenCalledWith(
      'vfs:container:00000000-0000-0000-0000-000000000010:sync',
      {
        type: 'vfs:cursor-bump',
        payload,
        timestamp: expect.any(String)
      }
    );

    const call = broadcastMock.mock.calls[0];
    const message = call?.[1];
    expect(typeof message).toBe('object');
    const timestampValue =
      typeof message === 'object' && message !== null
        ? Reflect.get(message, 'timestamp')
        : null;
    const parsedTimestamp = Date.parse(
      typeof timestampValue === 'string' ? timestampValue : ''
    );
    expect(Number.isFinite(parsedTimestamp)).toBe(true);
  });
});
