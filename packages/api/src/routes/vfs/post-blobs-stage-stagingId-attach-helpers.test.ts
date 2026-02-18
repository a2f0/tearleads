import { encodeVfsSyncCursor } from '@tearleads/vfs-sync/vfs';
import { describe, expect, it } from 'vitest';
import {
  dominatesLastWriteIds,
  parseBlobAttachConsistency,
  parseBlobLinkRelationKind,
  parseBlobLinkRelationKindFromSessionKey,
  toBlobLinkSessionKey,
  toScopedCrdtClientId
} from './post-blobs-stage-stagingId-attach-helpers.js';

describe('post-blobs-stage-stagingId-attach-helpers', () => {
  describe('parseBlobAttachConsistency', () => {
    it('returns null consistency when reconcile guardrails are omitted', () => {
      expect(parseBlobAttachConsistency(null)).toEqual({
        ok: true,
        value: null
      });

      expect(parseBlobAttachConsistency({ itemId: 'item-1' })).toEqual({
        ok: true,
        value: null
      });
    });

    it('requires clientId when reconcile guardrails are present', () => {
      expect(
        parseBlobAttachConsistency({
          requiredCursor: encodeVfsSyncCursor({
            changedAt: '2026-02-15T00:00:00.000Z',
            changeId: 'change-1'
          })
        })
      ).toEqual({
        ok: false,
        error: 'clientId is required when reconcile guardrails are provided'
      });
    });

    it('rejects namespaced client ids', () => {
      expect(
        parseBlobAttachConsistency({
          clientId: 'bad:client',
          requiredCursor: encodeVfsSyncCursor({
            changedAt: '2026-02-15T00:00:00.000Z',
            changeId: 'change-1'
          })
        })
      ).toEqual({
        ok: false,
        error: 'clientId must not contain ":"'
      });
    });

    it('requires a valid requiredCursor when guardrails are present', () => {
      expect(
        parseBlobAttachConsistency({
          clientId: 'client-1'
        })
      ).toEqual({
        ok: false,
        error:
          'requiredCursor is required when reconcile guardrails are provided'
      });

      expect(
        parseBlobAttachConsistency({
          clientId: 'client-1',
          requiredCursor: 'invalid'
        })
      ).toEqual({
        ok: false,
        error: 'Invalid requiredCursor'
      });
    });

    it('parses reconcile guardrails when payload is valid', () => {
      const requiredCursor = encodeVfsSyncCursor({
        changedAt: '2026-02-15T00:00:00.000Z',
        changeId: 'change-1'
      });
      const result = parseBlobAttachConsistency({
        clientId: 'client-1',
        requiredCursor,
        requiredLastReconciledWriteIds: {
          alpha: 7,
          beta: 3
        }
      });

      expect(result).toEqual({
        ok: true,
        value: {
          clientId: 'client-1',
          requiredCursor: {
            changedAt: '2026-02-15T00:00:00.000Z',
            changeId: 'change-1'
          },
          requiredLastReconciledWriteIds: {
            alpha: 7,
            beta: 3
          }
        }
      });
    });

    it('returns an error for invalid last write id payloads', () => {
      const result = parseBlobAttachConsistency({
        clientId: 'client-1',
        requiredCursor: encodeVfsSyncCursor({
          changedAt: '2026-02-15T00:00:00.000Z',
          changeId: 'change-1'
        }),
        requiredLastReconciledWriteIds: {
          alpha: 0
        }
      });

      expect(result.ok).toBe(false);
      if (result.ok) {
        throw new Error('Expected parseBlobAttachConsistency to fail');
      }

      expect(result.error).toContain(
        'lastReconciledWriteIds contains invalid writeId'
      );
    });
  });

  describe('toScopedCrdtClientId', () => {
    it('prefixes client ids with the crdt namespace', () => {
      expect(toScopedCrdtClientId('client-1')).toBe('crdt:client-1');
    });
  });

  describe('toBlobLinkSessionKey', () => {
    it('encodes relation kind in blob-link namespace', () => {
      expect(toBlobLinkSessionKey('emailAttachment')).toBe(
        'blob-link:emailAttachment'
      );
    });
  });

  describe('parseBlobLinkRelationKind', () => {
    it('reads relation kind from visible_children payloads', () => {
      expect(
        parseBlobLinkRelationKind({
          relationKind: ' file '
        })
      ).toBe('file');
      expect(parseBlobLinkRelationKind('bad-value')).toBeNull();
    });
  });

  describe('parseBlobLinkRelationKindFromSessionKey', () => {
    it('extracts relation kind only from blob-link session keys', () => {
      expect(parseBlobLinkRelationKindFromSessionKey('blob-link:file')).toBe(
        'file'
      );
      expect(parseBlobLinkRelationKindFromSessionKey('blob-link:')).toBeNull();
      expect(
        parseBlobLinkRelationKindFromSessionKey('blob-stage:attached')
      ).toBeNull();
    });
  });

  describe('dominatesLastWriteIds', () => {
    it('returns true when current write ids dominate required ids', () => {
      expect(
        dominatesLastWriteIds(
          {
            alpha: 5,
            beta: 8
          },
          {
            alpha: 5,
            beta: 4
          }
        )
      ).toBe(true);
    });

    it('returns false when a required replica write id is ahead', () => {
      expect(
        dominatesLastWriteIds(
          {
            alpha: 5
          },
          {
            alpha: 5,
            beta: 1
          }
        )
      ).toBe(false);
    });
  });
});
