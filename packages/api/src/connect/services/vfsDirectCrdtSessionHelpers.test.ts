import { Buffer } from 'node:buffer';
import type { VfsSyncBloomFilter } from '@tearleads/shared';
import { VfsBloomFilter, type VfsCrdtSyncDbRow } from '@tearleads/vfs-sync/vfs';
import { describe, expect, it } from 'vitest';
import {
  createRuntimeBloomFilter,
  mergeLastReconciledWriteIds,
  parseBloomFilter,
  parseLimit,
  parseOptionalRootId,
  shouldPruneSessionRow
} from './vfsDirectCrdtSessionHelpers.js';

function createBloomPayload(opIds: string[]): VfsSyncBloomFilter {
  const capacity = 64;
  const errorRate = 0.01;
  const bloom = new VfsBloomFilter({ capacity, errorRate });
  for (const opId of opIds) {
    bloom.add(opId);
  }

  return {
    data: Buffer.from(bloom.toUint8Array()).toString('base64'),
    capacity,
    errorRate
  };
}

function createRow(overrides: Partial<VfsCrdtSyncDbRow> = {}): VfsCrdtSyncDbRow {
  return {
    op_id: 'op-1',
    item_id: 'item-1',
    replica_id: 'replica-1',
    write_id: 3,
    op_type: 'acl_add',
    principal_type: 'user',
    principal_id: 'user-2',
    access_level: 'read',
    parent_id: null,
    child_id: null,
    actor_id: 'user-1',
    source_table: 'vfs_acl_entries',
    source_id: 'row-1',
    occurred_at: '2026-03-13T00:00:00.000Z',
    ...overrides
  };
}

describe('vfsDirectCrdtSessionHelpers', () => {
  describe('parseLimit', () => {
    it('accepts valid numeric and string limits', () => {
      expect(parseLimit(1)).toBe(1);
      expect(parseLimit(500)).toBe(500);
      expect(parseLimit('37')).toBe(37);
      expect(parseLimit('10.9')).toBe(10);
    });

    it('rejects invalid limits', () => {
      expect(parseLimit(0)).toBeNull();
      expect(parseLimit(501)).toBeNull();
      expect(parseLimit(12.1)).toBeNull();
      expect(parseLimit('0')).toBeNull();
      expect(parseLimit('x')).toBeNull();
      expect(parseLimit(undefined)).toBeNull();
      expect(parseLimit(null)).toBeNull();
    });
  });

  describe('parseOptionalRootId', () => {
    it('parses legacy string and compact bytes', () => {
      expect(parseOptionalRootId(' root-legacy ', undefined)).toBe('root-legacy');

      const compactRootId = Buffer.from('root-compact', 'utf8').toString('base64');
      expect(parseOptionalRootId(undefined, compactRootId)).toBe('root-compact');
    });

    it('returns null for invalid payloads', () => {
      expect(parseOptionalRootId(undefined, '***')).toBeNull();
      expect(parseOptionalRootId(undefined, [])).toBeNull();
    });
  });

  describe('parseBloomFilter', () => {
    it('parses nullish and valid payloads', () => {
      expect(parseBloomFilter(undefined)).toEqual({
        ok: true,
        value: null
      });
      expect(parseBloomFilter(null)).toEqual({
        ok: true,
        value: null
      });

      const parsed = parseBloomFilter({
        data: ' Zm9v ',
        capacity: 4,
        errorRate: 0.01
      });
      expect(parsed).toEqual({
        ok: true,
        value: {
          data: 'Zm9v',
          capacity: 4,
          errorRate: 0.01
        }
      });
    });

    it('rejects malformed payloads', () => {
      expect(parseBloomFilter('bad')).toEqual({
        ok: false,
        error: 'bloomFilter must be an object'
      });
      expect(
        parseBloomFilter({
          data: '',
          capacity: 1,
          errorRate: 0.01
        })
      ).toEqual({
        ok: false,
        error: 'bloomFilter.data must be a non-empty base64 string'
      });
      expect(
        parseBloomFilter({
          data: 'Zm9v',
          capacity: 0,
          errorRate: 0.01
        })
      ).toEqual({
        ok: false,
        error: 'bloomFilter.capacity must be a positive integer'
      });
      expect(
        parseBloomFilter({
          data: 'Zm9v',
          capacity: 1,
          errorRate: 1
        })
      ).toEqual({
        ok: false,
        error: 'bloomFilter.errorRate must be a number between 0 and 1'
      });
    });
  });

  describe('createRuntimeBloomFilter', () => {
    it('returns null for nullish and empty payloads', () => {
      expect(createRuntimeBloomFilter(null)).toBeNull();
      expect(
        createRuntimeBloomFilter({
          data: '',
          capacity: 8,
          errorRate: 0.01
        })
      ).toBeNull();
    });

    it('creates a runtime bloom filter from a valid payload', () => {
      const runtime = createRuntimeBloomFilter(createBloomPayload(['op-a']));
      expect(runtime?.has('op-a')).toBe(true);
      expect(runtime?.has('op-b')).toBe(false);
    });
  });

  describe('shouldPruneSessionRow', () => {
    it('returns false when runtime bloom filter is missing', () => {
      expect(
        shouldPruneSessionRow(createRow(), {
          runtimeBloomFilter: null,
          lastReconciledWriteIds: { 'replica-1': 99 }
        })
      ).toBe(false);
    });

    it('returns false when row metadata is missing or invalid', () => {
      const runtimeBloom = createRuntimeBloomFilter(createBloomPayload(['op-1']));
      if (!runtimeBloom) {
        throw new Error('expected runtime bloom filter');
      }

      expect(
        shouldPruneSessionRow(createRow({ replica_id: '   ' }), {
          runtimeBloomFilter: runtimeBloom,
          lastReconciledWriteIds: { 'replica-1': 99 }
        })
      ).toBe(false);
      expect(
        shouldPruneSessionRow(createRow({ write_id: 0 }), {
          runtimeBloomFilter: runtimeBloom,
          lastReconciledWriteIds: { 'replica-1': 99 }
        })
      ).toBe(false);
      expect(
        shouldPruneSessionRow(createRow({ write_id: 'nope' }), {
          runtimeBloomFilter: runtimeBloom,
          lastReconciledWriteIds: { 'replica-1': 99 }
        })
      ).toBe(false);
    });

    it('returns false when reconciled write id is behind or op is absent', () => {
      const runtimeBloom = createRuntimeBloomFilter(createBloomPayload(['op-a']));
      if (!runtimeBloom) {
        throw new Error('expected runtime bloom filter');
      }

      expect(
        shouldPruneSessionRow(createRow({ op_id: 'op-a', write_id: 4 }), {
          runtimeBloomFilter: runtimeBloom,
          lastReconciledWriteIds: { 'replica-1': 3 }
        })
      ).toBe(false);
      expect(
        shouldPruneSessionRow(createRow({ op_id: 'op-b', write_id: '3' }), {
          runtimeBloomFilter: runtimeBloom,
          lastReconciledWriteIds: { 'replica-1': 3 }
        })
      ).toBe(false);
    });

    it('returns true when op is already reconciled and present in bloom filter', () => {
      const runtimeBloom = createRuntimeBloomFilter(createBloomPayload(['op-a']));
      if (!runtimeBloom) {
        throw new Error('expected runtime bloom filter');
      }

      expect(
        shouldPruneSessionRow(createRow({ op_id: 'op-a', write_id: '3' }), {
          runtimeBloomFilter: runtimeBloom,
          lastReconciledWriteIds: { 'replica-1': 3 }
        })
      ).toBe(true);
    });
  });

  describe('mergeLastReconciledWriteIds', () => {
    it('keeps max write id per replica and sorts keys', () => {
      expect(
        mergeLastReconciledWriteIds(
          { 'replica-z': 5, 'replica-a': 2 },
          { 'replica-a': 7, 'replica-b': 1 },
          { 'replica-b': 4 }
        )
      ).toEqual({
        'replica-a': 7,
        'replica-b': 4,
        'replica-z': 5
      });
    });

    it('returns empty object when no sources are provided', () => {
      expect(mergeLastReconciledWriteIds()).toEqual({});
    });
  });
});
