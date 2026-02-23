import { describe, expect, it } from 'vitest';
import type { VfsCrdtSyncTransport } from './sync-client-test-support.js';
import {
  buildAclAddSyncItem,
  VfsBackgroundSyncClient
} from './sync-client-test-support.js';

describe('VfsBackgroundSyncClient', () => {
  it('applies transport reconcile acknowledgements when supported', async () => {
    const transport: VfsCrdtSyncTransport = {
      pushOperations: async () => ({
        results: []
      }),
      pullOperations: async () => ({
        items: [
          buildAclAddSyncItem({
            opId: 'desktop-1',
            occurredAt: '2026-02-14T12:20:00.000Z'
          })
        ],
        hasMore: false,
        nextCursor: {
          changedAt: '2026-02-14T12:20:00.000Z',
          changeId: 'desktop-1'
        },
        lastReconciledWriteIds: {
          desktop: 1
        }
      }),
      reconcileState: async () => ({
        cursor: {
          changedAt: '2026-02-14T12:20:01.000Z',
          changeId: 'desktop-2'
        },
        lastReconciledWriteIds: {
          desktop: 2,
          mobile: 4
        }
      })
    };

    const client = new VfsBackgroundSyncClient('user-1', 'desktop', transport);
    await client.sync();

    const snapshot = client.snapshot();
    expect(snapshot.cursor).toEqual({
      changedAt: '2026-02-14T12:20:01.000Z',
      changeId: 'desktop-2'
    });
    expect(snapshot.lastReconciledWriteIds).toEqual({
      desktop: 2,
      mobile: 4
    });
    expect(snapshot.nextLocalWriteId).toBe(3);
  });

  it('fails closed when reconcile acknowledgement regresses cursor', async () => {
    const guardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
    }> = [];
    const transport: VfsCrdtSyncTransport = {
      pushOperations: async () => ({
        results: []
      }),
      pullOperations: async () => ({
        items: [
          buildAclAddSyncItem({
            opId: 'desktop-2',
            occurredAt: '2026-02-14T12:21:00.000Z'
          })
        ],
        hasMore: false,
        nextCursor: {
          changedAt: '2026-02-14T12:21:00.000Z',
          changeId: 'desktop-2'
        },
        lastReconciledWriteIds: {
          desktop: 2
        }
      }),
      reconcileState: async () => ({
        cursor: {
          changedAt: '2026-02-14T12:20:59.000Z',
          changeId: 'desktop-1'
        },
        lastReconciledWriteIds: {
          desktop: 2
        }
      })
    };

    const client = new VfsBackgroundSyncClient('user-1', 'desktop', transport, {
      onGuardrailViolation: (violation) => {
        guardrailViolations.push({
          code: violation.code,
          stage: violation.stage,
          message: violation.message
        });
      }
    });
    await expect(client.sync()).rejects.toThrowError(
      /reconcile regressed sync cursor/
    );
    expect(guardrailViolations).toContainEqual({
      code: 'reconcileCursorRegression',
      stage: 'reconcile',
      message: 'reconcile acknowledgement regressed sync cursor'
    });
  });

  it('fails closed when reconcile acknowledgement regresses last write ids', async () => {
    const guardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
    }> = [];
    const transport: VfsCrdtSyncTransport = {
      pushOperations: async () => ({
        results: []
      }),
      pullOperations: async () => ({
        items: [
          buildAclAddSyncItem({
            opId: 'desktop-2',
            occurredAt: '2026-02-14T12:22:00.000Z'
          })
        ],
        hasMore: false,
        nextCursor: {
          changedAt: '2026-02-14T12:22:00.000Z',
          changeId: 'desktop-2'
        },
        lastReconciledWriteIds: {
          desktop: 2
        }
      }),
      reconcileState: async () => ({
        cursor: {
          changedAt: '2026-02-14T12:22:00.000Z',
          changeId: 'desktop-2'
        },
        lastReconciledWriteIds: {
          desktop: 1
        }
      })
    };

    const client = new VfsBackgroundSyncClient('user-1', 'desktop', transport, {
      onGuardrailViolation: (violation) => {
        guardrailViolations.push({
          code: violation.code,
          stage: violation.stage,
          message: violation.message
        });
      }
    });
    await expect(client.sync()).rejects.toThrowError(
      /regressed lastReconciledWriteIds/
    );
    expect(guardrailViolations).toContainEqual({
      code: 'lastWriteIdRegression',
      stage: 'reconcile',
      message: 'reconcile acknowledgement regressed replica write-id state'
    });
  });
});
