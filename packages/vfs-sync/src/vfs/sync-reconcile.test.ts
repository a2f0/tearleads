import { describe, expect, it } from 'vitest';
import {
  compareVfsSyncCursorOrder,
  InMemoryVfsSyncClientStateStore,
  parseVfsSyncReconcilePayload,
  reconcileVfsSyncCursor
} from './sync-reconcile.js';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe('parseVfsSyncReconcilePayload', () => {
  it('parses a valid payload', () => {
    const result = parseVfsSyncReconcilePayload({
      clientId: 'client-a',
      cursor: Buffer.from(
        JSON.stringify({
          version: 1,
          changedAt: '2025-02-01T00:00:00.000Z',
          changeId: 'change-10'
        }),
        'utf8'
      ).toString('base64url')
    });

    expect(result).toEqual({
      ok: true,
      value: {
        clientId: 'client-a',
        cursor: {
          changedAt: '2025-02-01T00:00:00.000Z',
          changeId: 'change-10'
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
      changeId: 'change-10'
    };
    const second = {
      changedAt: '2025-02-01T00:00:00.000Z',
      changeId: 'change-11'
    };

    expect(compareVfsSyncCursorOrder(first, second)).toBe(-1);
    expect(compareVfsSyncCursorOrder(second, first)).toBe(1);
  });

  it('keeps the highest cursor during reconcile', () => {
    const current = {
      changedAt: '2025-02-01T00:00:00.000Z',
      changeId: 'change-11'
    };
    const stale = {
      changedAt: '2025-02-01T00:00:00.000Z',
      changeId: 'change-09'
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
          changeId: 'change-10'
        }
      },
      {
        delayMs: 10,
        cursor: {
          changedAt: '2025-02-01T00:00:00.000Z',
          changeId: 'change-12'
        }
      },
      {
        delayMs: 20,
        cursor: {
          changedAt: '2025-02-01T00:00:01.000Z',
          changeId: 'change-01'
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
      changeId: 'change-01'
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
          changeId: 'change-99'
        });
      })(),
      (async () => {
        await wait(5);
        store.reconcile(userId, 'mobile', {
          changedAt: '2025-02-01T00:00:01.000Z',
          changeId: 'change-50'
        });
      })()
    ]);

    expect(store.get(userId, 'desktop')).toEqual({
      changedAt: '2025-02-01T00:00:02.000Z',
      changeId: 'change-99'
    });
    expect(store.get(userId, 'mobile')).toEqual({
      changedAt: '2025-02-01T00:00:01.000Z',
      changeId: 'change-50'
    });
  });
});
