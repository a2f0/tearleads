import { describe, expect, it } from 'vitest';
import {
  InMemoryVfsCrdtClientStateStore,
  mergeVfsCrdtLastReconciledWriteIds,
  parseVfsCrdtLastReconciledWriteIds,
  parseVfsCrdtReconcilePayload,
  reconcileVfsCrdtClientState
} from './sync-crdt-reconcile.js';
import { encodeVfsSyncCursor } from './sync-cursor.js';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe('parseVfsCrdtLastReconciledWriteIds', () => {
  it('parses valid replica write ids and returns stable key order', () => {
    const result = parseVfsCrdtLastReconciledWriteIds({
      mobile: 2,
      desktop: 5
    });

    expect(result).toEqual({
      ok: true,
      value: {
        desktop: 5,
        mobile: 2
      }
    });
  });

  it('defaults to an empty map when the field is omitted', () => {
    expect(parseVfsCrdtLastReconciledWriteIds(undefined)).toEqual({
      ok: true,
      value: {}
    });
  });

  it('fails when write ids are not positive integers', () => {
    expect(
      parseVfsCrdtLastReconciledWriteIds({
        desktop: 1.5
      })
    ).toEqual({
      ok: false,
      error:
        'lastReconciledWriteIds contains invalid writeId (must be a positive integer)'
    });

    expect(
      parseVfsCrdtLastReconciledWriteIds({
        desktop: 0
      })
    ).toEqual({
      ok: false,
      error:
        'lastReconciledWriteIds contains invalid writeId (must be a positive integer)'
    });
  });

  it('fails when replica ids are invalid', () => {
    expect(
      parseVfsCrdtLastReconciledWriteIds({
        '': 1
      })
    ).toEqual({
      ok: false,
      error:
        'lastReconciledWriteIds contains invalid replicaId (must be non-empty, <=128 chars, and must not include ":")'
    });

    expect(
      parseVfsCrdtLastReconciledWriteIds({
        'desktop:1': 2
      })
    ).toEqual({
      ok: false,
      error:
        'lastReconciledWriteIds contains invalid replicaId (must be non-empty, <=128 chars, and must not include ":")'
    });
  });

  it('fails closed when too many replica entries are provided', () => {
    const entries = Object.fromEntries(
      Array.from({ length: 513 }, (_, index) => [`replica-${index}`, 1])
    );

    expect(parseVfsCrdtLastReconciledWriteIds(entries)).toEqual({
      ok: false,
      error: 'lastReconciledWriteIds exceeds max entries (512)'
    });
  });
});

describe('parseVfsCrdtReconcilePayload', () => {
  it('parses reconcile payload with cursor and replica write ids', () => {
    const cursor = encodeVfsSyncCursor({
      changedAt: '2026-02-14T06:00:00.000Z',
      changeId: 'change-10'
    });

    const result = parseVfsCrdtReconcilePayload({
      clientId: 'desktop',
      cursor,
      lastReconciledWriteIds: {
        mobile: 3,
        desktop: 10
      }
    });

    expect(result).toEqual({
      ok: true,
      value: {
        clientId: 'desktop',
        cursor: {
          changedAt: '2026-02-14T06:00:00.000Z',
          changeId: 'change-10'
        },
        lastReconciledWriteIds: {
          desktop: 10,
          mobile: 3
        }
      }
    });
  });
});

describe('CRDT last write id reconciliation', () => {
  it('merges replica write ids monotonically with max semantics', () => {
    expect(
      mergeVfsCrdtLastReconciledWriteIds(
        {
          desktop: 9,
          mobile: 2
        },
        {
          desktop: 7,
          tablet: 3
        }
      )
    ).toEqual({
      desktop: 9,
      mobile: 2,
      tablet: 3
    });
  });

  it('keeps cursor monotonic while still advancing replica write ids', () => {
    const result = reconcileVfsCrdtClientState(
      {
        cursor: {
          changedAt: '2026-02-14T06:00:03.000Z',
          changeId: 'change-30'
        },
        lastReconciledWriteIds: {
          desktop: 3,
          mobile: 1
        }
      },
      {
        changedAt: '2026-02-14T06:00:02.000Z',
        changeId: 'change-20'
      },
      {
        desktop: 2,
        mobile: 5,
        tablet: 1
      }
    );

    expect(result).toEqual({
      state: {
        cursor: {
          changedAt: '2026-02-14T06:00:03.000Z',
          changeId: 'change-30'
        },
        lastReconciledWriteIds: {
          desktop: 3,
          mobile: 5,
          tablet: 1
        }
      },
      advancedCursor: false,
      advancedLastReconciledWriteIds: true
    });
  });
});

describe('InMemoryVfsCrdtClientStateStore', () => {
  it('handles concurrent io for one client and stays monotonic', async () => {
    const store = new InMemoryVfsCrdtClientStateStore();
    const userId = 'user-1';
    const clientId = 'desktop';

    const writes = [
      {
        delayMs: 20,
        cursor: {
          changedAt: '2026-02-14T06:00:01.000Z',
          changeId: 'change-10'
        },
        lastReconciledWriteIds: {
          desktop: 10
        }
      },
      {
        delayMs: 10,
        cursor: {
          changedAt: '2026-02-14T06:00:02.000Z',
          changeId: 'change-20'
        },
        lastReconciledWriteIds: {
          desktop: 11,
          mobile: 3
        }
      },
      {
        delayMs: 30,
        cursor: {
          changedAt: '2026-02-14T06:00:01.000Z',
          changeId: 'change-09'
        },
        lastReconciledWriteIds: {
          mobile: 4
        }
      }
    ];

    await Promise.all(
      writes.map(async (write) => {
        await wait(write.delayMs);
        store.reconcile(
          userId,
          clientId,
          write.cursor,
          write.lastReconciledWriteIds
        );
      })
    );

    expect(store.get(userId, clientId)).toEqual({
      cursor: {
        changedAt: '2026-02-14T06:00:02.000Z',
        changeId: 'change-20'
      },
      lastReconciledWriteIds: {
        desktop: 11,
        mobile: 4
      }
    });
  });

  it('isolates concurrent writes between multiple clients', async () => {
    const store = new InMemoryVfsCrdtClientStateStore();
    const userId = 'user-1';

    await Promise.all([
      (async () => {
        await wait(5);
        store.reconcile(
          userId,
          'desktop',
          {
            changedAt: '2026-02-14T06:10:00.000Z',
            changeId: 'desktop-100'
          },
          {
            desktop: 100
          }
        );
      })(),
      (async () => {
        await wait(10);
        store.reconcile(
          userId,
          'mobile',
          {
            changedAt: '2026-02-14T06:11:00.000Z',
            changeId: 'mobile-90'
          },
          {
            mobile: 90
          }
        );
      })()
    ]);

    expect(store.get(userId, 'desktop')).toEqual({
      cursor: {
        changedAt: '2026-02-14T06:10:00.000Z',
        changeId: 'desktop-100'
      },
      lastReconciledWriteIds: {
        desktop: 100
      }
    });
    expect(store.get(userId, 'mobile')).toEqual({
      cursor: {
        changedAt: '2026-02-14T06:11:00.000Z',
        changeId: 'mobile-90'
      },
      lastReconciledWriteIds: {
        mobile: 90
      }
    });
  });
});
