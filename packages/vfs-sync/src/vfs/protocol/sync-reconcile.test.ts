import { describe, expect, it } from 'vitest';
import { encodeVfsSyncCursor } from './sync-cursor.js';
import {
  compareVfsSyncCursorOrder,
  InMemoryVfsSyncClientStateStore,
  parseVfsSyncReconcilePayload,
  reconcileVfsSyncCursor
} from './sync-reconcile.js';

const CHANGE_ID_01 = '00000000-0000-0000-0000-000000000001';
const CHANGE_ID_09 = '00000000-0000-0000-0000-000000000009';
const CHANGE_ID_10 = '00000000-0000-0000-0000-000000000010';
const CHANGE_ID_11 = '00000000-0000-0000-0000-000000000011';
const CHANGE_ID_12 = '00000000-0000-0000-0000-000000000012';
const CHANGE_ID_50 = '00000000-0000-0000-0000-000000000050';
const CHANGE_ID_99 = '00000000-0000-0000-0000-000000000099';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe('parseVfsSyncReconcilePayload', () => {
  it('parses a valid payload', () => {
    const result = parseVfsSyncReconcilePayload({
      clientId: 'client-a',
      cursor: encodeVfsSyncCursor({
        changedAt: '2025-02-01T00:00:00.000Z',
        changeId: CHANGE_ID_10
      })
    });

    expect(result).toEqual({
      ok: true,
      value: {
        clientId: 'client-a',
        cursor: {
          changedAt: '2025-02-01T00:00:00.000Z',
          changeId: CHANGE_ID_10
        }
      }
    });
  });

  it('fails for invalid cursor', () => {
    const result = parseVfsSyncReconcilePayload({
      clientId: 'client-a',
      cursor: 'bad-cursor'
    });

    expect(result).toEqual({
      ok: false,
      error: 'Invalid cursor'
    });
  });
});

describe('cursor ordering and reconciliation', () => {
  it('orders cursors by timestamp then changeId', () => {
    const first = {
      changedAt: '2025-02-01T00:00:00.000Z',
      changeId: CHANGE_ID_10
    };
    const second = {
      changedAt: '2025-02-01T00:00:00.000Z',
      changeId: CHANGE_ID_11
    };

    expect(compareVfsSyncCursorOrder(first, second)).toBe(-1);
    expect(compareVfsSyncCursorOrder(second, first)).toBe(1);
  });

  it('keeps the highest cursor during reconcile', () => {
    const current = {
      changedAt: '2025-02-01T00:00:00.000Z',
      changeId: CHANGE_ID_11
    };
    const stale = {
      changedAt: '2025-02-01T00:00:00.000Z',
      changeId: CHANGE_ID_09
    };

    expect(reconcileVfsSyncCursor(current, stale)).toEqual({
      cursor: current,
      advanced: false
    });
  });
});

describe('InMemoryVfsSyncClientStateStore', () => {
  it('simulates concurrent writes for the same client and remains monotonic', async () => {
    const store = new InMemoryVfsSyncClientStateStore();
    const userId = 'user-1';
    const clientId = 'desktop';

    const writes = [
      {
        delayMs: 30,
        cursor: {
          changedAt: '2025-02-01T00:00:00.000Z',
          changeId: CHANGE_ID_10
        }
      },
      {
        delayMs: 10,
        cursor: {
          changedAt: '2025-02-01T00:00:00.000Z',
          changeId: CHANGE_ID_12
        }
      },
      {
        delayMs: 20,
        cursor: {
          changedAt: '2025-02-01T00:00:01.000Z',
          changeId: CHANGE_ID_01
        }
      }
    ];

    await Promise.all(
      writes.map(async (write) => {
        await wait(write.delayMs);
        store.reconcile(userId, clientId, write.cursor);
      })
    );

    expect(store.get(userId, clientId)).toEqual({
      changedAt: '2025-02-01T00:00:01.000Z',
      changeId: CHANGE_ID_01
    });
  });

  it('isolates concurrent writes across multiple clients', async () => {
    const store = new InMemoryVfsSyncClientStateStore();
    const userId = 'user-1';

    await Promise.all([
      (async () => {
        await wait(10);
        store.reconcile(userId, 'desktop', {
          changedAt: '2025-02-01T00:00:02.000Z',
          changeId: CHANGE_ID_99
        });
      })(),
      (async () => {
        await wait(5);
        store.reconcile(userId, 'mobile', {
          changedAt: '2025-02-01T00:00:01.000Z',
          changeId: CHANGE_ID_50
        });
      })()
    ]);

    expect(store.get(userId, 'desktop')).toEqual({
      changedAt: '2025-02-01T00:00:02.000Z',
      changeId: CHANGE_ID_99
    });
    expect(store.get(userId, 'mobile')).toEqual({
      changedAt: '2025-02-01T00:00:01.000Z',
      changeId: CHANGE_ID_50
    });
  });
});
