import { describe, expect, it } from 'vitest';
import {
  assertCanonicalVfsCrdtOperationOrder,
  reconcileCanonicalVfsCrdtOperations,
  type VfsCrdtOperation
} from './sync-crdt.js';

describe('canonical CRDT ordering guardrails', () => {
  it('accepts canonical feed ordering and applies deterministically', () => {
    const operations: VfsCrdtOperation[] = [
      {
        opId: 'op-1',
        opType: 'acl_add',
        itemId: 'item-a',
        replicaId: 'desktop',
        writeId: 1,
        occurredAt: '2026-02-14T02:00:00.000Z',
        principalType: 'user',
        principalId: 'user-7',
        accessLevel: 'read'
      },
      {
        opId: 'op-2',
        opType: 'acl_add',
        itemId: 'item-a',
        replicaId: 'mobile',
        writeId: 1,
        occurredAt: '2026-02-14T02:00:01.000Z',
        principalType: 'user',
        principalId: 'user-7',
        accessLevel: 'write'
      }
    ];

    expect(() =>
      assertCanonicalVfsCrdtOperationOrder(operations)
    ).not.toThrow();
    expect(reconcileCanonicalVfsCrdtOperations(operations)).toEqual({
      acl: [
        {
          itemId: 'item-a',
          principalType: 'user',
          principalId: 'user-7',
          accessLevel: 'write'
        }
      ],
      links: [],
      lastReconciledWriteIds: {
        desktop: 1,
        mobile: 1
      }
    });
  });

  it('throws when feed ordering is not strictly monotonic', () => {
    const operations: VfsCrdtOperation[] = [
      {
        opId: 'op-2',
        opType: 'acl_add',
        itemId: 'item-a',
        replicaId: 'desktop',
        writeId: 1,
        occurredAt: '2026-02-14T02:00:02.000Z',
        principalType: 'user',
        principalId: 'user-7',
        accessLevel: 'write'
      },
      {
        opId: 'op-1',
        opType: 'acl_add',
        itemId: 'item-a',
        replicaId: 'mobile',
        writeId: 1,
        occurredAt: '2026-02-14T02:00:01.000Z',
        principalType: 'user',
        principalId: 'user-7',
        accessLevel: 'read'
      }
    ];

    expect(() => assertCanonicalVfsCrdtOperationOrder(operations)).toThrowError(
      /violates feed ordering/
    );
  });

  it('throws when replica write ids are not monotonic in canonical feed', () => {
    const operations: VfsCrdtOperation[] = [
      {
        opId: 'op-1',
        opType: 'acl_add',
        itemId: 'item-a',
        replicaId: 'desktop',
        writeId: 2,
        occurredAt: '2026-02-14T02:00:01.000Z',
        principalType: 'user',
        principalId: 'user-7',
        accessLevel: 'write'
      },
      {
        opId: 'op-2',
        opType: 'acl_remove',
        itemId: 'item-a',
        replicaId: 'desktop',
        writeId: 1,
        occurredAt: '2026-02-14T02:00:02.000Z',
        principalType: 'user',
        principalId: 'user-7'
      }
    ];

    expect(() => assertCanonicalVfsCrdtOperationOrder(operations)).toThrowError(
      /non-monotonic writeId/
    );
  });

  it('throws when canonical feed contains self-referential link operations', () => {
    const operations: VfsCrdtOperation[] = [
      {
        opId: 'op-self-link',
        opType: 'link_add',
        itemId: 'item-a',
        replicaId: 'desktop',
        writeId: 1,
        occurredAt: '2026-02-14T02:00:01.000Z',
        parentId: 'item-a',
        childId: 'item-a'
      }
    ];

    expect(() => assertCanonicalVfsCrdtOperationOrder(operations)).toThrowError(
      /is invalid/
    );
  });

  it('throws when canonical feed contains childId/itemId mismatch link operations', () => {
    const operations: VfsCrdtOperation[] = [
      {
        opId: 'op-child-mismatch',
        opType: 'link_add',
        itemId: 'item-a',
        replicaId: 'desktop',
        writeId: 1,
        occurredAt: '2026-02-14T02:00:02.000Z',
        parentId: 'folder-root',
        childId: 'item-b'
      }
    ];

    expect(() => assertCanonicalVfsCrdtOperationOrder(operations)).toThrowError(
      /is invalid/
    );
  });
});
