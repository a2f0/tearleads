import { describe, expect, it } from 'vitest';
import {
  toIsoString,
  toLastReconciledWriteIds
} from './vfsDirectCrdtRouteHelpers.js';

describe('vfsDirectCrdtRouteHelpers', () => {
  describe('toLastReconciledWriteIds', () => {
    it('returns a deterministic replica clock map sorted by replica id', () => {
      const result = toLastReconciledWriteIds([
        { replica_id: 'replica-b', max_write_id: '7' },
        { replica_id: 'replica-a', max_write_id: 5 }
      ]);

      expect(Object.keys(result)).toEqual(['replica-a', 'replica-b']);
      expect(result).toEqual({
        'replica-a': 5,
        'replica-b': 7
      });
    });

    it('drops malformed rows', () => {
      expect(
        toLastReconciledWriteIds([
          { replica_id: '  ', max_write_id: 4 },
          { replica_id: 'replica-a', max_write_id: 0 },
          { replica_id: 'replica-b', max_write_id: 'nope' },
          { replica_id: null, max_write_id: 2 },
          { replica_id: 'replica-c', max_write_id: 3 }
        ])
      ).toEqual({
        'replica-c': 3
      });
    });
  });

  describe('toIsoString', () => {
    it('serializes Date inputs directly', () => {
      expect(toIsoString(new Date('2026-02-16T00:00:00.000Z'))).toBe(
        '2026-02-16T00:00:00.000Z'
      );
    });

    it('normalizes parseable strings and rejects invalid strings', () => {
      expect(toIsoString('2026-02-16T00:00:00Z')).toBe(
        '2026-02-16T00:00:00.000Z'
      );
      expect(toIsoString('not-a-date')).toBeNull();
    });
  });
});
