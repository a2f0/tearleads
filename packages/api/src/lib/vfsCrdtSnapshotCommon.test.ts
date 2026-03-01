import { describe, expect, it } from 'vitest';
import {
  cloneCursor,
  cloneWriteIds,
  isAccessLevel,
  isPrincipalType,
  mergeWriteIds,
  normalizeReplicaWriteIds,
  normalizeRequiredString,
  parseCursor,
  parseLastReconciledWriteIds,
  parseOccurredAt,
  pickNewerCursor
} from './vfsCrdtSnapshotCommon.js';

describe('vfsCrdtSnapshotCommon', () => {
  it('normalizes required strings and parses occurredAt values', () => {
    expect(normalizeRequiredString('  value  ')).toBe('value');
    expect(normalizeRequiredString('   ')).toBeNull();
    expect(normalizeRequiredString(42)).toBeNull();

    expect(parseOccurredAt(null)).toBeNull();
    expect(parseOccurredAt('not-a-date')).toBeNull();
    expect(parseOccurredAt('2026-02-24T12:00:00.000Z')).toBe(
      '2026-02-24T12:00:00.000Z'
    );
    expect(parseOccurredAt(new Date('2026-02-24T12:00:01.000Z'))).toBe(
      '2026-02-24T12:00:01.000Z'
    );
  });

  it('parses cursor values and validates principal/access enums', () => {
    expect(parseCursor(null, 'change-1')).toBeNull();
    expect(parseCursor('2026-02-24T12:00:00.000Z', null)).toBeNull();
    expect(parseCursor('2026-02-24T12:00:00.000Z', 'change-1')).toEqual({
      changedAt: '2026-02-24T12:00:00.000Z',
      changeId: 'change-1'
    });

    expect(isPrincipalType('user')).toBe(true);
    expect(isPrincipalType('invalid')).toBe(false);
    expect(isAccessLevel('admin')).toBe(true);
    expect(isAccessLevel('invalid')).toBe(false);
  });

  it('normalizes and parses replica write-id maps', () => {
    expect(
      normalizeReplicaWriteIds([
        { replica_id: ' desktop ', max_write_id: '10' },
        { replica_id: 'mobile', max_write_id: 2 },
        { replica_id: '', max_write_id: 5 },
        { replica_id: 'tablet', max_write_id: 0 }
      ])
    ).toEqual({
      desktop: 10,
      mobile: 2
    });

    expect(parseLastReconciledWriteIds('{bad-json')).toEqual({});
    expect(parseLastReconciledWriteIds(['not-a-record'])).toEqual({});
    expect(
      parseLastReconciledWriteIds({
        desktop: '11',
        mobile: 3,
        tablet: 0,
        bad: 'x'
      })
    ).toEqual({
      desktop: 11,
      mobile: 3
    });
  });

  it('merges write ids, selects newer cursor, and clones values', () => {
    expect(
      mergeWriteIds(
        { desktop: 2, mobile: 1 },
        { desktop: 3, tablet: 9, mobile: 1 }
      )
    ).toEqual({
      desktop: 3,
      mobile: 1,
      tablet: 9
    });

    const newer = {
      changedAt: '2026-02-24T12:00:10.000Z',
      changeId: 'change-2'
    };
    const older = {
      changedAt: '2026-02-24T12:00:00.000Z',
      changeId: 'change-1'
    };
    expect(pickNewerCursor(null, newer)).toEqual(newer);
    expect(pickNewerCursor(older, null)).toEqual(older);
    expect(pickNewerCursor(older, newer)).toEqual(newer);

    const cursorClone = cloneCursor(newer);
    expect(cursorClone).toEqual(newer);
    expect(cursorClone).not.toBe(newer);

    const writeIds = { desktop: 7, mobile: 5 };
    const writeIdsClone = cloneWriteIds(writeIds);
    expect(writeIdsClone).toEqual(writeIds);
    expect(writeIdsClone).not.toBe(writeIds);
  });
});
