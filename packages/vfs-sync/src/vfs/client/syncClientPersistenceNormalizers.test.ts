import { describe, expect, it } from 'vitest';
import { normalizePersistedPendingOperation } from './sync-client-persistence-normalizers.js';

describe('normalizePersistedPendingOperation', () => {
  it('preserves link_reassign link fields during hydrate', () => {
    const operation = normalizePersistedPendingOperation({
      operation: {
        opId: 'desktop-1',
        opType: 'link_reassign',
        itemId: 'reading-1',
        replicaId: 'desktop',
        writeId: 1,
        occurredAt: '2026-02-16T00:00:00.000Z',
        parentId: 'contact-2',
        childId: 'reading-1'
      },
      index: 0,
      clientId: 'desktop'
    });

    expect(operation).toEqual({
      opId: 'desktop-1',
      opType: 'link_reassign',
      itemId: 'reading-1',
      replicaId: 'desktop',
      writeId: 1,
      occurredAt: '2026-02-16T00:00:00.000Z',
      parentId: 'contact-2',
      childId: 'reading-1'
    });
  });

  it('rejects mismatched link_reassign child scope during hydrate', () => {
    expect(() =>
      normalizePersistedPendingOperation({
        operation: {
          opId: 'desktop-2',
          opType: 'link_reassign',
          itemId: 'reading-1',
          replicaId: 'desktop',
          writeId: 2,
          occurredAt: '2026-02-16T00:00:01.000Z',
          parentId: 'contact-2',
          childId: 'reading-2'
        },
        index: 1,
        clientId: 'desktop'
      })
    ).toThrowError(
      'state.pendingOperations[1] has link childId that does not match itemId'
    );
  });
});
