import { describe, expect, it } from 'vitest';
import {
  normalizeCanonicalOccurredAt,
  parseMaxWriteId,
  toPushSourceId,
  toReplicaPrefix
} from './post-crdt-push-canonical.js';

describe('post-crdt-push-canonical', () => {
  describe('toPushSourceId', () => {
    it('encodes user, replica, write id, and op id', () => {
      expect(
        toPushSourceId('user-1', {
          opId: 'op-9',
          opType: 'acl_remove',
          itemId: 'item-2',
          replicaId: 'client-3',
          writeId: 42,
          occurredAt: '2026-02-16T00:00:00.000Z',
          principalType: 'user',
          principalId: 'user-4'
        })
      ).toBe('user-1:client-3:42:op-9');
    });
  });

  describe('toReplicaPrefix', () => {
    it('builds the user-scoped replica prefix', () => {
      expect(toReplicaPrefix('user-1', 'client-3')).toBe('user-1:client-3:');
    });
  });

  describe('parseMaxWriteId', () => {
    it('returns 0 when no row is present', () => {
      expect(parseMaxWriteId(undefined)).toBe(0);
    });

    it('parses numeric and string max_write_id values', () => {
      expect(
        parseMaxWriteId({
          max_write_id: 9,
          max_occurred_at: null
        })
      ).toBe(9);
      expect(
        parseMaxWriteId({
          max_write_id: '12',
          max_occurred_at: null
        })
      ).toBe(12);
    });

    it('returns 0 for non-numeric max_write_id values', () => {
      expect(
        parseMaxWriteId({
          max_write_id: 'not-a-number',
          max_occurred_at: null
        })
      ).toBe(0);
      expect(
        parseMaxWriteId({
          max_write_id: null,
          max_occurred_at: null
        })
      ).toBe(0);
    });
  });

  describe('normalizeCanonicalOccurredAt', () => {
    it('normalizes valid input timestamps when no max exists', () => {
      expect(normalizeCanonicalOccurredAt('2026-02-16T00:00:00Z', null)).toBe(
        '2026-02-16T00:00:00.000Z'
      );
    });

    it('bumps occurredAt by 1ms when input does not advance max', () => {
      expect(
        normalizeCanonicalOccurredAt(
          '2026-02-16T00:00:00.100Z',
          '2026-02-16T00:00:00.500Z'
        )
      ).toBe('2026-02-16T00:00:00.501Z');
    });

    it('keeps occurredAt when it already advances max', () => {
      expect(
        normalizeCanonicalOccurredAt(
          '2026-02-16T00:00:01.000Z',
          '2026-02-16T00:00:00.500Z'
        )
      ).toBe('2026-02-16T00:00:01.000Z');
    });

    it('throws for invalid input timestamps', () => {
      expect(() =>
        normalizeCanonicalOccurredAt('not-a-date', '2026-02-16T00:00:00.500Z')
      ).toThrow('operation occurredAt is invalid');
    });
  });
});
