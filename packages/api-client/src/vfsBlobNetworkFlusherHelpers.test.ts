import { describe, expect, it } from 'vitest';
import {
  cloneOperation,
  cloneOperations,
  isBlobRelationKind,
  isValidLastReconciledWriteIds,
  normalizeApiPrefix,
  normalizeAttachConsistency,
  normalizeBaseUrl,
  normalizeIsoTimestamp,
  normalizeRequiredString,
  parseErrorMessage
} from './vfsBlobNetworkFlusherHelpers';

describe('vfsBlobNetworkFlusherHelpers', () => {
  it('normalizes base URL and API prefix', () => {
    expect(normalizeBaseUrl(' https://example.com/ ')).toBe(
      'https://example.com'
    );
    expect(normalizeBaseUrl('   ')).toBe('');

    expect(normalizeApiPrefix('v1/')).toBe('/v1');
    expect(normalizeApiPrefix(' /v1/ ')).toBe('/v1');
    expect(normalizeApiPrefix('   ')).toBe('');
  });

  it('parses error messages and string/timestamp values', () => {
    expect(parseErrorMessage({ error: 'boom' }, 'fallback')).toBe('boom');
    expect(parseErrorMessage({ message: 'msg' }, 'fallback')).toBe('msg');
    expect(parseErrorMessage({ foo: 'bar' }, 'fallback')).toBe('fallback');
    expect(parseErrorMessage(null, 'fallback')).toBe('fallback');

    expect(normalizeRequiredString(' hello ')).toBe('hello');
    expect(normalizeRequiredString(42)).toBeNull();
    expect(normalizeRequiredString('   ')).toBeNull();

    expect(normalizeIsoTimestamp('2026-02-18T00:00:00.000Z')).toBe(
      '2026-02-18T00:00:00.000Z'
    );
    expect(normalizeIsoTimestamp('not-a-date')).toBeNull();
  });

  it('validates relation kinds and reconciled write IDs', () => {
    expect(isBlobRelationKind('file')).toBe(true);
    expect(isBlobRelationKind('invalid-kind')).toBe(false);

    expect(isValidLastReconciledWriteIds({ desktop: 1, mobile: 0 })).toBe(true);
    expect(isValidLastReconciledWriteIds([])).toBe(false);
    expect(isValidLastReconciledWriteIds({ '': 1 })).toBe(false);
    expect(isValidLastReconciledWriteIds({ desktop: -1 })).toBe(false);
    expect(isValidLastReconciledWriteIds({ desktop: 1.2 })).toBe(false);
  });

  it('clones operations and normalizes attach consistency', () => {
    const stageOperation = {
      operationId: 'op-stage',
      kind: 'stage' as const,
      payload: {
        stagingId: 'stage-1',
        blobId: 'blob-1',
        expiresAt: '2026-02-18T01:00:00.000Z'
      }
    };
    const attachOperation = {
      operationId: 'op-attach',
      kind: 'attach' as const,
      payload: {
        stagingId: 'stage-1',
        itemId: 'item-1',
        relationKind: 'file' as const,
        consistency: {
          clientId: 'desktop',
          requiredCursor: {
            changedAt: '2026-02-18T00:00:00.000Z',
            changeId: 'op-1'
          },
          requiredLastReconciledWriteIds: { desktop: 1 }
        }
      }
    };
    const abandonOperation = {
      operationId: 'op-abandon',
      kind: 'abandon' as const,
      payload: {
        stagingId: 'stage-1'
      }
    };

    expect(cloneOperation(stageOperation)).toEqual(stageOperation);
    expect(cloneOperation(attachOperation)).toEqual(attachOperation);
    expect(cloneOperation(abandonOperation)).toEqual(abandonOperation);
    expect(
      cloneOperations([stageOperation, attachOperation, abandonOperation])
    ).toEqual([stageOperation, attachOperation, abandonOperation]);

    expect(
      normalizeAttachConsistency({
        clientId: 'desktop',
        requiredCursor: {
          changedAt: '2026-02-18T00:00:00.000Z',
          changeId: 'op-1'
        },
        requiredLastReconciledWriteIds: { desktop: 1 }
      })
    ).toEqual({
      clientId: 'desktop',
      requiredCursor: {
        changedAt: '2026-02-18T00:00:00.000Z',
        changeId: 'op-1'
      },
      requiredLastReconciledWriteIds: { desktop: 1 }
    });
    expect(normalizeAttachConsistency(undefined)).toBeUndefined();
    expect(() =>
      normalizeAttachConsistency({
        clientId: 'desktop:invalid',
        requiredCursor: {
          changedAt: '2026-02-18T00:00:00.000Z',
          changeId: 'op-1'
        },
        requiredLastReconciledWriteIds: { desktop: 1 }
      })
    ).toThrow(/consistency\.clientId is invalid/);
    expect(() =>
      normalizeAttachConsistency({
        clientId: 'desktop',
        requiredCursor: {
          changedAt: 'not-a-date',
          changeId: ''
        },
        requiredLastReconciledWriteIds: { desktop: 1 }
      })
    ).toThrow(/consistency\.requiredCursor is invalid/);
    expect(() =>
      normalizeAttachConsistency({
        clientId: 'desktop',
        requiredCursor: {
          changedAt: '2026-02-18T00:00:00.000Z',
          changeId: 'op-1'
        },
        requiredLastReconciledWriteIds: { desktop: -1 }
      })
    ).toThrow(/requiredLastReconciledWriteIds is invalid/);
  });
});
