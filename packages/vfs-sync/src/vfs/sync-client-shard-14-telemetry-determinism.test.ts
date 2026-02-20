import { describe, expect, it } from 'vitest';
import type { VfsCrdtSyncTransport } from './sync-client-test-support.js';
import {
  buildAclAddSyncItem,
  InMemoryVfsCrdtSyncServer,
  InMemoryVfsCrdtSyncTransport,
  VfsBackgroundSyncClient,
  VfsCrdtSyncPushRejectedError
} from './sync-client-test-support.js';
import {
  createGuardrailViolationCollector,
  expectExactGuardrailSignatures,
  expectGuardrailSignature,
  expectHydrateGuardrailViolation,
  expectPullCursorRegressionViolation,
  expectPullDuplicateOpReplayViolation,
  expectPullPageInvariantViolation,
  expectReconcileCursorRegressionViolation,
  expectStaleWriteRecoveryExhaustedViolation,
  toStageCodeSignatures
} from './sync-client-test-support-observers.js';

/**
 * Phase E: Guardrail telemetry determinism tests
 *
 * These tests verify that all guardrail violations:
 * 1. Emit deterministic stage:code signatures
 * 2. Include actionable details for diagnosis
 * 3. Always throw errors after emitting telemetry (no silent fallbacks)
 */

describe('VfsBackgroundSyncClient guardrail telemetry determinism', () => {
  describe('pull stage guardrails', () => {
    it('emits pullPageInvariantViolation with deterministic signature for hasMore=true empty page', async () => {
      const guardrailCollector = createGuardrailViolationCollector();
      const transport: VfsCrdtSyncTransport = {
        pushOperations: async () => ({ results: [] }),
        pullOperations: async () => ({
          items: [],
          hasMore: true,
          nextCursor: null,
          lastReconciledWriteIds: {}
        })
      };

      const client = new VfsBackgroundSyncClient(
        'user-1',
        'desktop',
        transport,
        {
          pullLimit: 10,
          onGuardrailViolation: guardrailCollector.onGuardrailViolation
        }
      );

      await expect(client.sync()).rejects.toThrow(
        /hasMore=true with an empty pull page/
      );

      expectGuardrailSignature({
        violations: guardrailCollector.violations,
        signature: 'pull:pullPageInvariantViolation'
      });

      expectPullPageInvariantViolation({
        violations: guardrailCollector.violations,
        hasMore: true,
        itemsLength: 0
      });
    });

    it('emits pullDuplicateOpReplay with deterministic signature and opId detail', async () => {
      const guardrailCollector = createGuardrailViolationCollector();
      let pullCount = 0;

      const transport: VfsCrdtSyncTransport = {
        pushOperations: async () => ({ results: [] }),
        pullOperations: async () => {
          pullCount += 1;
          if (pullCount === 1) {
            return {
              items: [
                buildAclAddSyncItem({
                  opId: 'duplicate-op',
                  occurredAt: '2026-02-20T10:00:00.000Z',
                  itemId: 'item-1'
                })
              ],
              hasMore: true,
              nextCursor: {
                changedAt: '2026-02-20T10:00:00.000Z',
                changeId: 'duplicate-op'
              },
              lastReconciledWriteIds: { desktop: 1 }
            };
          }
          return {
            items: [
              buildAclAddSyncItem({
                opId: 'duplicate-op',
                occurredAt: '2026-02-20T10:01:00.000Z',
                itemId: 'item-2'
              })
            ],
            hasMore: false,
            nextCursor: {
              changedAt: '2026-02-20T10:01:00.000Z',
              changeId: 'duplicate-op'
            },
            lastReconciledWriteIds: { desktop: 1 }
          };
        }
      };

      const client = new VfsBackgroundSyncClient(
        'user-1',
        'desktop',
        transport,
        {
          pullLimit: 1,
          onGuardrailViolation: guardrailCollector.onGuardrailViolation
        }
      );

      await expect(client.sync()).rejects.toThrow(
        /replayed opId.*duplicate-op/
      );

      expectGuardrailSignature({
        violations: guardrailCollector.violations,
        signature: 'pull:pullDuplicateOpReplay'
      });

      expectPullDuplicateOpReplayViolation({
        violations: guardrailCollector.violations,
        opId: 'duplicate-op'
      });
    });

    it('emits pullCursorRegression with deterministic signature and cursor details', async () => {
      const guardrailCollector = createGuardrailViolationCollector();
      let pullCount = 0;

      const transport: VfsCrdtSyncTransport = {
        pushOperations: async () => ({ results: [] }),
        pullOperations: async () => {
          pullCount += 1;
          if (pullCount === 1) {
            return {
              items: [
                buildAclAddSyncItem({
                  opId: 'op-1',
                  occurredAt: '2026-02-20T10:00:00.000Z',
                  itemId: 'item-1'
                })
              ],
              hasMore: true,
              nextCursor: {
                changedAt: '2026-02-20T10:00:00.000Z',
                changeId: 'op-1'
              },
              lastReconciledWriteIds: { desktop: 1 }
            };
          }
          return {
            items: [],
            hasMore: false,
            nextCursor: {
              changedAt: '2026-02-20T09:59:00.000Z',
              changeId: 'regressed-op'
            },
            lastReconciledWriteIds: { desktop: 1 }
          };
        }
      };

      const client = new VfsBackgroundSyncClient(
        'user-1',
        'desktop',
        transport,
        {
          pullLimit: 1,
          onGuardrailViolation: guardrailCollector.onGuardrailViolation
        }
      );

      await expect(client.sync()).rejects.toThrow(/regressing sync cursor/);

      expectGuardrailSignature({
        violations: guardrailCollector.violations,
        signature: 'pull:pullCursorRegression'
      });

      expectPullCursorRegressionViolation({
        violations: guardrailCollector.violations,
        previousChangedAt: '2026-02-20T10:00:00.000Z',
        previousChangeId: 'op-1',
        incomingChangedAt: '2026-02-20T09:59:00.000Z',
        incomingChangeId: 'regressed-op'
      });
    });
  });

  describe('reconcile stage guardrails', () => {
    it('emits reconcileCursorRegression with deterministic signature', async () => {
      const guardrailCollector = createGuardrailViolationCollector();
      const server = new InMemoryVfsCrdtSyncServer();

      await server.pushOperations({
        operations: [
          {
            opId: 'seed-op',
            opType: 'acl_add',
            itemId: 'item-seed',
            replicaId: 'remote',
            writeId: 1,
            occurredAt: '2026-02-20T10:00:00.000Z',
            principalType: 'group',
            principalId: 'group-1',
            accessLevel: 'read'
          }
        ]
      });

      const transport: VfsCrdtSyncTransport = {
        pushOperations: (input) =>
          server.pushOperations({ operations: input.operations }),
        pullOperations: (input) =>
          server.pullOperations({ cursor: input.cursor, limit: input.limit }),
        reconcileState: async () => ({
          cursor: {
            changedAt: '2026-02-20T09:00:00.000Z',
            changeId: 'regressed-cursor'
          },
          lastReconciledWriteIds: { desktop: 1 }
        })
      };

      const client = new VfsBackgroundSyncClient(
        'user-1',
        'desktop',
        transport,
        {
          pullLimit: 10,
          onGuardrailViolation: guardrailCollector.onGuardrailViolation
        }
      );

      await expect(client.sync()).rejects.toThrow(/reconcile regressed/);

      expectGuardrailSignature({
        violations: guardrailCollector.violations,
        signature: 'reconcile:reconcileCursorRegression'
      });

      expectReconcileCursorRegressionViolation({
        violations: guardrailCollector.violations,
        previousChangedAt: '2026-02-20T10:00:00.000Z',
        previousChangeId: 'seed-op',
        incomingChangedAt: '2026-02-20T09:00:00.000Z',
        incomingChangeId: 'regressed-cursor'
      });
    });
  });

  describe('flush stage guardrails', () => {
    it('emits staleWriteRecoveryExhausted with deterministic signature and retry details', async () => {
      const guardrailCollector = createGuardrailViolationCollector();

      const transport: VfsCrdtSyncTransport = {
        pushOperations: async (input) => ({
          results: input.operations.map((op) => ({
            opId: op.opId,
            status: 'staleWriteId' as const
          }))
        }),
        pullOperations: async () => ({
          items: [],
          hasMore: false,
          nextCursor: null,
          lastReconciledWriteIds: {}
        })
      };

      const client = new VfsBackgroundSyncClient(
        'user-1',
        'desktop',
        transport,
        {
          pullLimit: 10,
          onGuardrailViolation: guardrailCollector.onGuardrailViolation
        }
      );

      client.queueLocalOperation({
        opType: 'acl_add',
        itemId: 'item-stale',
        principalType: 'user',
        principalId: 'user-1',
        accessLevel: 'read',
        occurredAt: '2026-02-20T10:00:00.000Z'
      });

      await expect(client.flush()).rejects.toBeInstanceOf(
        VfsCrdtSyncPushRejectedError
      );

      expectGuardrailSignature({
        violations: guardrailCollector.violations,
        signature: 'flush:staleWriteRecoveryExhausted'
      });

      expectStaleWriteRecoveryExhaustedViolation({
        violations: guardrailCollector.violations,
        attempts: 3,
        maxAttempts: 2
      });
    });
  });

  describe('hydrate stage guardrails', () => {
    it('emits hydrateGuardrailViolation with deterministic signature for malformed state', async () => {
      const guardrailCollector = createGuardrailViolationCollector();
      const server = new InMemoryVfsCrdtSyncServer();

      const client = new VfsBackgroundSyncClient(
        'user-1',
        'desktop',
        new InMemoryVfsCrdtSyncTransport(server),
        {
          pullLimit: 10,
          onGuardrailViolation: guardrailCollector.onGuardrailViolation
        }
      );

      const malformedState = {
        pendingOperations: [],
        localWriteId: -1,
        replaySnapshot: {
          acl: [],
          links: [],
          cursor: null,
          lastReconciledWriteIds: {},
          containerClocks: []
        }
      };

      expect(() => client.hydrateState(malformedState)).toThrow();

      expectGuardrailSignature({
        violations: guardrailCollector.violations,
        signature: 'hydrate:hydrateGuardrailViolation'
      });

      expectHydrateGuardrailViolation({
        violations: guardrailCollector.violations
      });
    });
  });

  describe('telemetry assertion helper coverage', () => {
    it('toStageCodeSignatures produces deterministic signature format', () => {
      const events = [
        { stage: 'pull', code: 'pullPageInvariantViolation' },
        { stage: 'flush', code: 'staleWriteRecoveryExhausted' },
        { stage: 'hydrate', code: 'hydrateGuardrailViolation' }
      ];

      const signatures = toStageCodeSignatures(events);

      expect(signatures).toEqual([
        'pull:pullPageInvariantViolation',
        'flush:staleWriteRecoveryExhausted',
        'hydrate:hydrateGuardrailViolation'
      ]);
    });

    it('expectExactGuardrailSignatures validates exhaustive signature sets', () => {
      const violations = [
        {
          code: 'pullPageInvariantViolation',
          stage: 'pull',
          message: 'test'
        },
        {
          code: 'staleWriteRecoveryExhausted',
          stage: 'flush',
          message: 'test'
        }
      ];

      expectExactGuardrailSignatures({
        violations,
        signatures: [
          'pull:pullPageInvariantViolation',
          'flush:staleWriteRecoveryExhausted'
        ]
      });
    });
  });
});
