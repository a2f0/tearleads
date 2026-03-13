import { describe, expect, it } from 'vitest';
import {
  InMemoryVfsCrdtStateStore,
  reconcileVfsCrdtOperations,
  type VfsCrdtOperation
} from './sync-crdt.js';

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

describe('InMemoryVfsCrdtStateStore link_reassign', () => {
  it('reassigns child from one parent to another', () => {
    const store = new InMemoryVfsCrdtStateStore();

    store.apply({
      opId: 'add-1',
      opType: 'link_add',
      itemId: 'child-1',
      replicaId: 'desktop',
      writeId: 1,
      occurredAt: '2026-02-14T00:00:01.000Z',
      parentId: 'parent-a',
      childId: 'child-1'
    });

    const result = store.apply({
      opId: 'reassign-1',
      opType: 'link_reassign',
      itemId: 'child-1',
      replicaId: 'desktop',
      writeId: 2,
      occurredAt: '2026-02-14T00:00:02.000Z',
      parentId: 'parent-b',
      childId: 'child-1'
    });

    expect(result).toEqual({ opId: 'reassign-1', status: 'applied' });
    expect(store.snapshot().links).toEqual([
      { parentId: 'parent-b', childId: 'child-1' }
    ]);
  });

  it('concurrent link_reassign to different parents converges to one', () => {
    const operations: VfsCrdtOperation[] = [
      {
        opId: 'add-1',
        opType: 'link_add',
        itemId: 'child-1',
        replicaId: 'desktop',
        writeId: 1,
        occurredAt: '2026-02-14T00:00:01.000Z',
        parentId: 'parent-a',
        childId: 'child-1'
      },
      {
        opId: 'reassign-desktop',
        opType: 'link_reassign',
        itemId: 'child-1',
        replicaId: 'desktop',
        writeId: 2,
        occurredAt: '2026-02-14T00:00:02.000Z',
        parentId: 'parent-b',
        childId: 'child-1'
      },
      {
        opId: 'reassign-mobile',
        opType: 'link_reassign',
        itemId: 'child-1',
        replicaId: 'mobile',
        writeId: 1,
        occurredAt: '2026-02-14T00:00:03.000Z',
        parentId: 'parent-c',
        childId: 'child-1'
      }
    ];

    const expected = reconcileVfsCrdtOperations(operations);

    for (const perm of permutations(operations)) {
      expect(reconcileVfsCrdtOperations(perm)).toEqual(expected);
    }

    expect(expected.links).toEqual([
      { parentId: 'parent-c', childId: 'child-1' }
    ]);
  });

  it('link_reassign vs older link_add on same child: reassign wins', () => {
    const operations: VfsCrdtOperation[] = [
      {
        opId: 'reassign-1',
        opType: 'link_reassign',
        itemId: 'child-1',
        replicaId: 'desktop',
        writeId: 1,
        occurredAt: '2026-02-14T00:00:02.000Z',
        parentId: 'parent-b',
        childId: 'child-1'
      },
      {
        opId: 'add-old',
        opType: 'link_add',
        itemId: 'child-1',
        replicaId: 'mobile',
        writeId: 1,
        occurredAt: '2026-02-14T00:00:01.000Z',
        parentId: 'parent-a',
        childId: 'child-1'
      }
    ];

    const expected = reconcileVfsCrdtOperations(operations);

    for (const perm of permutations(operations)) {
      expect(reconcileVfsCrdtOperations(perm)).toEqual(expected);
    }

    expect(expected.links).toEqual([
      { parentId: 'parent-b', childId: 'child-1' }
    ]);
  });

  it('link_reassign vs newer link_add: both present (opt-in)', () => {
    const operations: VfsCrdtOperation[] = [
      {
        opId: 'reassign-1',
        opType: 'link_reassign',
        itemId: 'child-1',
        replicaId: 'desktop',
        writeId: 1,
        occurredAt: '2026-02-14T00:00:01.000Z',
        parentId: 'parent-a',
        childId: 'child-1'
      },
      {
        opId: 'add-newer',
        opType: 'link_add',
        itemId: 'child-1',
        replicaId: 'mobile',
        writeId: 1,
        occurredAt: '2026-02-14T00:00:02.000Z',
        parentId: 'parent-b',
        childId: 'child-1'
      }
    ];

    const expected = reconcileVfsCrdtOperations(operations);

    for (const perm of permutations(operations)) {
      expect(reconcileVfsCrdtOperations(perm)).toEqual(expected);
    }

    expect(expected.links).toEqual([
      { parentId: 'parent-a', childId: 'child-1' },
      { parentId: 'parent-b', childId: 'child-1' }
    ]);
  });

  it('idempotent replay of link_reassign operations', () => {
    const store = new InMemoryVfsCrdtStateStore();

    const reassignOp: VfsCrdtOperation = {
      opId: 'reassign-1',
      opType: 'link_reassign',
      itemId: 'child-1',
      replicaId: 'desktop',
      writeId: 1,
      occurredAt: '2026-02-14T00:00:02.000Z',
      parentId: 'parent-b',
      childId: 'child-1'
    };

    store.apply({
      opId: 'add-1',
      opType: 'link_add',
      itemId: 'child-1',
      replicaId: 'mobile',
      writeId: 1,
      occurredAt: '2026-02-14T00:00:01.000Z',
      parentId: 'parent-a',
      childId: 'child-1'
    });

    const first = store.apply(reassignOp);
    expect(first.status).toBe('applied');

    const second = store.apply(reassignOp);
    expect(second.status).toBe('staleWriteId');

    expect(store.snapshot().links).toEqual([
      { parentId: 'parent-b', childId: 'child-1' }
    ]);
  });

  it('out-of-order delivery converges to same state', () => {
    const operations: VfsCrdtOperation[] = [
      {
        opId: 'add-a',
        opType: 'link_add',
        itemId: 'child-1',
        replicaId: 'r1',
        writeId: 1,
        occurredAt: '2026-02-14T00:00:01.000Z',
        parentId: 'parent-a',
        childId: 'child-1'
      },
      {
        opId: 'add-b',
        opType: 'link_add',
        itemId: 'child-1',
        replicaId: 'r2',
        writeId: 1,
        occurredAt: '2026-02-14T00:00:02.000Z',
        parentId: 'parent-b',
        childId: 'child-1'
      },
      {
        opId: 'reassign-c',
        opType: 'link_reassign',
        itemId: 'child-1',
        replicaId: 'r3',
        writeId: 1,
        occurredAt: '2026-02-14T00:00:03.000Z',
        parentId: 'parent-c',
        childId: 'child-1'
      },
      {
        opId: 'add-d',
        opType: 'link_add',
        itemId: 'child-1',
        replicaId: 'r4',
        writeId: 1,
        occurredAt: '2026-02-14T00:00:04.000Z',
        parentId: 'parent-d',
        childId: 'child-1'
      }
    ];

    const expected = reconcileVfsCrdtOperations(operations);

    for (const perm of permutations(operations)) {
      expect(reconcileVfsCrdtOperations(perm)).toEqual(expected);
    }

    expect(expected.links).toEqual([
      { parentId: 'parent-c', childId: 'child-1' },
      { parentId: 'parent-d', childId: 'child-1' }
    ]);
  });

  it('rejects self-referential link_reassign', () => {
    const store = new InMemoryVfsCrdtStateStore();

    const result = store.apply({
      opId: 'self-reassign',
      opType: 'link_reassign',
      itemId: 'child-1',
      replicaId: 'desktop',
      writeId: 1,
      occurredAt: '2026-02-14T00:00:01.000Z',
      parentId: 'child-1',
      childId: 'child-1'
    });

    expect(result).toEqual({
      opId: 'self-reassign',
      status: 'invalidOp'
    });
  });

  it('rejects link_reassign with childId mismatch', () => {
    const store = new InMemoryVfsCrdtStateStore();

    const result = store.apply({
      opId: 'mismatch-reassign',
      opType: 'link_reassign',
      itemId: 'child-1',
      replicaId: 'desktop',
      writeId: 1,
      occurredAt: '2026-02-14T00:00:01.000Z',
      parentId: 'parent-a',
      childId: 'child-2'
    });

    expect(result).toEqual({
      opId: 'mismatch-reassign',
      status: 'invalidOp'
    });
  });

  it('link_reassign tombstones multiple existing parents', () => {
    const operations: VfsCrdtOperation[] = [
      {
        opId: 'add-a',
        opType: 'link_add',
        itemId: 'child-1',
        replicaId: 'r1',
        writeId: 1,
        occurredAt: '2026-02-14T00:00:01.000Z',
        parentId: 'parent-a',
        childId: 'child-1'
      },
      {
        opId: 'add-b',
        opType: 'link_add',
        itemId: 'child-1',
        replicaId: 'r2',
        writeId: 1,
        occurredAt: '2026-02-14T00:00:02.000Z',
        parentId: 'parent-b',
        childId: 'child-1'
      },
      {
        opId: 'add-c',
        opType: 'link_add',
        itemId: 'child-1',
        replicaId: 'r3',
        writeId: 1,
        occurredAt: '2026-02-14T00:00:03.000Z',
        parentId: 'parent-c',
        childId: 'child-1'
      },
      {
        opId: 'reassign-d',
        opType: 'link_reassign',
        itemId: 'child-1',
        replicaId: 'r4',
        writeId: 1,
        occurredAt: '2026-02-14T00:00:04.000Z',
        parentId: 'parent-d',
        childId: 'child-1'
      }
    ];

    const expected = reconcileVfsCrdtOperations(operations);

    for (const perm of permutations(operations)) {
      expect(reconcileVfsCrdtOperations(perm)).toEqual(expected);
    }

    expect(expected.links).toEqual([
      { parentId: 'parent-d', childId: 'child-1' }
    ]);
  });

  it('link_reassign to same parent is a no-op on other parents', () => {
    const store = new InMemoryVfsCrdtStateStore();

    store.apply({
      opId: 'add-1',
      opType: 'link_add',
      itemId: 'child-1',
      replicaId: 'desktop',
      writeId: 1,
      occurredAt: '2026-02-14T00:00:01.000Z',
      parentId: 'parent-a',
      childId: 'child-1'
    });

    const result = store.apply({
      opId: 'reassign-same',
      opType: 'link_reassign',
      itemId: 'child-1',
      replicaId: 'desktop',
      writeId: 2,
      occurredAt: '2026-02-14T00:00:02.000Z',
      parentId: 'parent-a',
      childId: 'child-1'
    });

    expect(result.status).toBe('applied');
    expect(store.snapshot().links).toEqual([
      { parentId: 'parent-a', childId: 'child-1' }
    ]);
  });
});
