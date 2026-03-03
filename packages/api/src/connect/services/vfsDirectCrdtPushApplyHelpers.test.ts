import type { VfsCrdtPushOperation } from '@tearleads/shared';
import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import {
  applyCanonicalItemOperation,
  compareCursor,
  pickNewerOccurredAt,
  resolveContainerId,
  upsertReplicaHead,
  type TimedQueryRunner
} from './vfsDirectCrdtPushApplyHelpers.js';

function createOperation(
  overrides: Partial<VfsCrdtPushOperation>
): VfsCrdtPushOperation {
  return {
    opId: 'op-1',
    opType: 'item_upsert',
    itemId: 'item-1',
    replicaId: 'desktop',
    writeId: 1,
    occurredAt: '2026-02-16T00:00:00.000Z',
    ...overrides
  };
}

function createEmptyQueryResult<T extends QueryResultRow>(): QueryResult<T> {
  return {
    command: 'SELECT',
    rowCount: 0,
    oid: 0,
    rows: [],
    fields: []
  };
}

function createRecordingQueryRunner(recorder: Array<{ label: string }>): TimedQueryRunner {
  return async <T extends QueryResultRow>(
    label: string,
    _text: string,
    _values?: unknown[]
  ) => {
    recorder.push({ label });
    return createEmptyQueryResult<T>();
  };
}

describe('vfsDirectCrdtPushApplyHelpers', () => {
  describe('compareCursor', () => {
    it('orders by changedAt first and then changeId', () => {
      expect(
        compareCursor(
          { changedAt: '2026-02-16T00:00:00.000Z', changeId: 'a' },
          { changedAt: '2026-02-16T00:00:01.000Z', changeId: 'a' }
        )
      ).toBeLessThan(0);

      expect(
        compareCursor(
          { changedAt: '2026-02-16T00:00:01.000Z', changeId: 'b' },
          { changedAt: '2026-02-16T00:00:01.000Z', changeId: 'a' }
        )
      ).toBeGreaterThan(0);
    });
  });

  describe('resolveContainerId', () => {
    it('uses parent id for link operations and item id for non-link operations', () => {
      expect(
        resolveContainerId(
          createOperation({
            opType: 'link_add',
            parentId: ' parent-1 '
          })
        )
      ).toBe('parent-1');

      expect(
        resolveContainerId(
          createOperation({
            opType: 'item_delete',
            itemId: ' item-2 '
          })
        )
      ).toBe('item-2');
    });

    it('returns null when required ids are blank', () => {
      expect(
        resolveContainerId(
          createOperation({
            opType: 'link_remove',
            parentId: '   '
          })
        )
      ).toBeNull();

      expect(
        resolveContainerId(
          createOperation({
            opType: 'item_upsert',
            itemId: '   '
          })
        )
      ).toBeNull();
    });
  });

  describe('pickNewerOccurredAt', () => {
    it('keeps current when candidate is missing or invalid', () => {
      expect(pickNewerOccurredAt('2026-02-16T00:00:00.000Z', null)).toBe(
        '2026-02-16T00:00:00.000Z'
      );
      expect(
        pickNewerOccurredAt('2026-02-16T00:00:00.000Z', 'not-a-date')
      ).toBe('2026-02-16T00:00:00.000Z');
    });

    it('prefers the newer timestamp', () => {
      expect(
        pickNewerOccurredAt(null, '2026-02-16T00:00:00.000Z')
      ).toBe('2026-02-16T00:00:00.000Z');
      expect(
        pickNewerOccurredAt(
          '2026-02-16T00:00:00.000Z',
          '2026-02-16T00:00:01.000Z'
        )
      ).toBe('2026-02-16T00:00:01.000Z');
      expect(
        pickNewerOccurredAt(
          '2026-02-16T00:00:01.000Z',
          '2026-02-16T00:00:00.000Z'
        )
      ).toBe('2026-02-16T00:00:01.000Z');
    });
  });

  describe('upsertReplicaHead', () => {
    it('issues an upsert query', async () => {
      const labels: Array<{ label: string }> = [];
      const runQuery = createRecordingQueryRunner(labels);

      await upsertReplicaHead(
        runQuery,
        'user-1',
        'desktop',
        9,
        '2026-02-16T00:00:00.000Z'
      );

      expect(labels).toEqual([{ label: 'replica_head_upsert' }]);
    });
  });

  describe('applyCanonicalItemOperation', () => {
    it('applies canonical upsert queries for item_upsert', async () => {
      const labels: Array<{ label: string }> = [];
      const runQuery = createRecordingQueryRunner(labels);

      await applyCanonicalItemOperation(
        runQuery,
        'user-1',
        createOperation({
          opType: 'item_upsert',
          encryptedPayload: 'payload',
          keyEpoch: 1,
          encryptionNonce: 'nonce',
          encryptionAad: 'aad',
          encryptionSignature: 'sig'
        })
      );

      expect(labels).toEqual([
        { label: 'canonical_item_upsert' },
        { label: 'canonical_sync_change_upsert' }
      ]);
    });

    it('applies canonical delete queries for item_delete', async () => {
      const labels: Array<{ label: string }> = [];
      const runQuery = createRecordingQueryRunner(labels);

      await applyCanonicalItemOperation(
        runQuery,
        'user-1',
        createOperation({
          opType: 'item_delete'
        })
      );

      expect(labels).toEqual([
        { label: 'canonical_item_delete' },
        { label: 'canonical_sync_change_delete' }
      ]);
    });

    it('does nothing for non-item operations', async () => {
      const labels: Array<{ label: string }> = [];
      const runQuery = createRecordingQueryRunner(labels);

      await applyCanonicalItemOperation(
        runQuery,
        'user-1',
        createOperation({
          opType: 'acl_add',
          principalType: 'user',
          principalId: 'user-2',
          accessLevel: 'read'
        })
      );

      expect(labels).toEqual([]);
    });
  });
});
