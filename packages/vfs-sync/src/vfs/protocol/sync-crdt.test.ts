import { describe, expect, it } from 'vitest';
import {
  InMemoryVfsCrdtStateStore,
  reconcileVfsCrdtOperations,
  type VfsCrdtOperation
} from './sync-crdt.js';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function permutations<T>(values: T[]): T[][] {
  if (values.length <= 1) {
    return [values.slice()];
  }

  const result: T[][] = [];
  for (let i = 0; i < values.length; i++) {
    const current = values[i];
    if (current === undefined) {
      continue;
    }

    const remainingValues = values.slice(0, i).concat(values.slice(i + 1));
    for (const permutation of permutations(remainingValues)) {
      result.push([current, ...permutation]);
    }
  }

  return result;
}

class ConcurrentClientHarness {
  constructor(private readonly store: InMemoryVfsCrdtStateStore) {}

  run(writes: Array<{ operation: VfsCrdtOperation; delayMs: number }>): Promise<
    Array<{
      opId: string;
      status: 'applied' | 'staleWriteId' | 'outdatedOp' | 'invalidOp';
    }>
  > {
    return Promise.all(
      writes.map(async ({ operation, delayMs }) => {
        await wait(delayMs);
        return this.store.apply(operation);
      })
    );
  }
}

describe('InMemoryVfsCrdtStateStore', () => {
  it('drops stale write ids from the same replica', () => {
    const store = new InMemoryVfsCrdtStateStore();

    const result = store.applyMany([
      {
        opId: 'desktop-2',
        opType: 'acl_add',
        itemId: 'item-1',
        replicaId: 'desktop',
        writeId: 2,
        occurredAt: '2026-02-14T00:00:02.000Z',
        principalType: 'user',
        principalId: 'user-2',
        accessLevel: 'write'
      },
      {
        opId: 'desktop-1',
        opType: 'acl_add',
        itemId: 'item-1',
        replicaId: 'desktop',
        writeId: 1,
        occurredAt: '2026-02-14T00:00:01.000Z',
        principalType: 'user',
        principalId: 'user-2',
        accessLevel: 'read'
      }
    ]);

    expect(result).toEqual([
      {
        opId: 'desktop-2',
        status: 'applied'
      },
      {
        opId: 'desktop-1',
        status: 'staleWriteId'
      }
    ]);

    expect(store.snapshot()).toEqual({
      acl: [
        {
          itemId: 'item-1',
          principalType: 'user',
          principalId: 'user-2',
          accessLevel: 'write'
        }
      ],
      links: [],
      lastReconciledWriteIds: {
        desktop: 2
      }
    });
  });

  it('converges to the same result regardless of operation arrival order', () => {
    const operations: VfsCrdtOperation[] = [
      {
        opId: 'desktop-1',
        opType: 'acl_add',
        itemId: 'item-1',
        replicaId: 'desktop',
        writeId: 1,
        occurredAt: '2026-02-14T00:00:01.000Z',
        principalType: 'user',
        principalId: 'user-3',
        accessLevel: 'read'
      },
      {
        opId: 'mobile-1',
        opType: 'acl_add',
        itemId: 'item-1',
        replicaId: 'mobile',
        writeId: 1,
        occurredAt: '2026-02-14T00:00:02.000Z',
        principalType: 'user',
        principalId: 'user-3',
        accessLevel: 'write'
      },
      {
        opId: 'desktop-2',
        opType: 'acl_remove',
        itemId: 'item-1',
        replicaId: 'desktop',
        writeId: 2,
        occurredAt: '2026-02-14T00:00:03.000Z',
        principalType: 'user',
        principalId: 'user-3'
      }
    ];

    const expected = reconcileVfsCrdtOperations(operations);

    for (const permutation of permutations(operations)) {
      expect(reconcileVfsCrdtOperations(permutation)).toEqual(expected);
    }

    expect(expected).toEqual({
      acl: [],
      links: [],
      lastReconciledWriteIds: {
        desktop: 2,
        mobile: 1
      }
    });
  });

  it('handles concurrent client io for acl and hierarchy link updates', async () => {
    const store = new InMemoryVfsCrdtStateStore();
    const harness = new ConcurrentClientHarness(store);

    const results = await harness.run([
      {
        delayMs: 15,
        operation: {
          opId: 'desktop-1',
          opType: 'acl_add',
          itemId: 'item-9',
          replicaId: 'desktop',
          writeId: 1,
          occurredAt: '2026-02-14T00:01:00.000Z',
          principalType: 'group',
          principalId: 'group-1',
          accessLevel: 'read'
        }
      },
      {
        delayMs: 5,
        operation: {
          opId: 'mobile-1',
          opType: 'acl_add',
          itemId: 'item-9',
          replicaId: 'mobile',
          writeId: 1,
          occurredAt: '2026-02-14T00:01:01.000Z',
          principalType: 'group',
          principalId: 'group-1',
          accessLevel: 'write'
        }
      },
      {
        delayMs: 10,
        operation: {
          opId: 'desktop-2',
          opType: 'link_add',
          itemId: 'item-9',
          replicaId: 'desktop',
          writeId: 2,
          occurredAt: '2026-02-14T00:01:02.000Z',
          parentId: 'folder-root',
          childId: 'item-9'
        }
      },
      {
        delayMs: 20,
        operation: {
          opId: 'mobile-2',
          opType: 'link_remove',
          itemId: 'item-9',
          replicaId: 'mobile',
          writeId: 2,
          occurredAt: '2026-02-14T00:01:03.000Z',
          parentId: 'folder-root',
          childId: 'item-9'
        }
      },
      {
        delayMs: 25,
        operation: {
          opId: 'tablet-1',
          opType: 'link_add',
          itemId: 'item-9',
          replicaId: 'tablet',
          writeId: 1,
          occurredAt: '2026-02-14T00:01:04.000Z',
          parentId: 'folder-root',
          childId: 'item-9'
        }
      }
    ]);

    expect(results).toEqual([
      {
        opId: 'desktop-1',
        status: 'staleWriteId'
      },
      {
        opId: 'mobile-1',
        status: 'applied'
      },
      {
        opId: 'desktop-2',
        status: 'applied'
      },
      {
        opId: 'mobile-2',
        status: 'applied'
      },
      {
        opId: 'tablet-1',
        status: 'applied'
      }
    ]);

    expect(store.snapshot()).toEqual({
      acl: [
        {
          itemId: 'item-9',
          principalType: 'group',
          principalId: 'group-1',
          accessLevel: 'write'
        }
      ],
      links: [
        {
          parentId: 'folder-root',
          childId: 'item-9'
        }
      ],
      lastReconciledWriteIds: {
        desktop: 2,
        mobile: 2,
        tablet: 1
      }
    });
  });

  it('keeps tombstones so older add operations cannot resurrect removed access', () => {
    const store = new InMemoryVfsCrdtStateStore();

    const result = store.applyMany([
      {
        opId: 'mobile-1',
        opType: 'acl_remove',
        itemId: 'item-3',
        replicaId: 'mobile',
        writeId: 1,
        occurredAt: '2026-02-14T01:00:02.000Z',
        principalType: 'organization',
        principalId: 'org-1'
      },
      {
        opId: 'desktop-1',
        opType: 'acl_add',
        itemId: 'item-3',
        replicaId: 'desktop',
        writeId: 1,
        occurredAt: '2026-02-14T01:00:01.000Z',
        principalType: 'organization',
        principalId: 'org-1',
        accessLevel: 'admin'
      }
    ]);

    expect(result).toEqual([
      {
        opId: 'mobile-1',
        status: 'applied'
      },
      {
        opId: 'desktop-1',
        status: 'outdatedOp'
      }
    ]);

    expect(store.snapshot()).toEqual({
      acl: [],
      links: [],
      lastReconciledWriteIds: {
        desktop: 1,
        mobile: 1
      }
    });
  });

  it('rejects malformed operations', () => {
    const store = new InMemoryVfsCrdtStateStore();

    const result = store.apply({
      opId: '',
      opType: 'acl_add',
      itemId: 'item-1',
      replicaId: 'desktop',
      writeId: 1,
      occurredAt: 'not-a-date',
      principalType: 'user',
      principalId: 'user-1',
      accessLevel: 'read'
    });

    expect(result).toEqual({
      opId: '',
      status: 'invalidOp'
    });
  });

  it('rejects self-referential link operations', () => {
    const store = new InMemoryVfsCrdtStateStore();

    const result = store.apply({
      opId: 'self-link-1',
      opType: 'link_add',
      itemId: 'item-1',
      replicaId: 'desktop',
      writeId: 1,
      occurredAt: '2026-02-14T03:00:00.000Z',
      parentId: 'item-1',
      childId: 'item-1'
    });

    expect(result).toEqual({
      opId: 'self-link-1',
      status: 'invalidOp'
    });
    expect(store.snapshot()).toEqual({
      acl: [],
      links: [],
      lastReconciledWriteIds: {}
    });
  });

  it('rejects link operations whose childId does not match itemId', () => {
    const store = new InMemoryVfsCrdtStateStore();

    const result = store.apply({
      opId: 'link-child-mismatch-1',
      opType: 'link_add',
      itemId: 'item-1',
      replicaId: 'desktop',
      writeId: 1,
      occurredAt: '2026-02-14T03:00:01.000Z',
      parentId: 'folder-root',
      childId: 'item-2'
    });

    expect(result).toEqual({
      opId: 'link-child-mismatch-1',
      status: 'invalidOp'
    });
    expect(store.snapshot()).toEqual({
      acl: [],
      links: [],
      lastReconciledWriteIds: {}
    });
  });
});
