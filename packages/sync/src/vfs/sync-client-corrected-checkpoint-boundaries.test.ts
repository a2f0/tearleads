import { describe, expect, it } from 'vitest';
import {
  VfsBackgroundSyncClient,
  type VfsCrdtSyncTransport
} from './sync-client.js';
import {
  InMemoryVfsCrdtSyncServer,
  InMemoryVfsCrdtSyncTransport
} from './sync-client-harness.js';
import {
  createDeterministicRandom,
  createSeededIsoTimestampFactory,
  pickOne,
  readForwardContainerSignatures,
  readSeedContainerCursorOrThrow,
  toStageCodeSignatures
} from './sync-client-randomized-test-support.js';

describe('VfsBackgroundSyncClient', () => {
  it('keeps corrected-checkpoint recovery stable across pull and container window pagination boundaries', async () => {
    const runScenario = async (input: {
      seed: number;
      pullLimit: number;
      containerWindowLimit: number;
    }): Promise<{
      forwardSignatures: string[];
      pulledOpIds: string[];
      pullCursorSignatures: string[];
      guardrailSignatures: string[];
    }> => {
      const random = createDeterministicRandom(input.seed);
      const localParents = ['root', 'archive', 'workspace'] as const;
      const remoteParents = ['projects', 'teams', 'inbox'] as const;
      const principalTypes = ['group', 'organization'] as const;
      const accessLevels = ['read', 'write', 'admin'] as const;
      const localParentId = pickOne(localParents, random);
      const remoteParentId = pickOne(remoteParents, random);
      const principalType = pickOne(principalTypes, random);
      const accessLevel = pickOne(accessLevels, random);

      const remoteSeedOpId = `remote-seed-boundary-${input.seed}`;
      const remoteAclOpId = `remote-acl-boundary-${input.seed}`;
      const remoteLinkOpId = `remote-link-boundary-${input.seed}`;
      const localAclOpId = `local-acl-boundary-${input.seed}`;
      const localLinkOpId = `local-link-boundary-${input.seed}`;

      const itemSeed = `item-seed-boundary-${input.seed}`;
      const itemRemoteAcl = `item-remote-acl-boundary-${input.seed}`;
      const itemRemoteLink = `item-remote-link-boundary-${input.seed}`;
      const itemLocalAcl = `item-local-acl-boundary-${input.seed}`;
      const itemLocalLink = `item-local-link-boundary-${input.seed}`;

      const at = createSeededIsoTimestampFactory({
        baseIso: '2026-02-14T13:10:00.000Z',
        seed: input.seed,
        seedStrideMs: 1_000
      });

      const server = new InMemoryVfsCrdtSyncServer();
      await server.pushOperations({
        operations: [
          {
            opId: remoteSeedOpId,
            opType: 'acl_add',
            itemId: itemSeed,
            replicaId: 'remote',
            writeId: 1,
            occurredAt: at(0),
            principalType: 'group',
            principalId: `group-seed-boundary-${input.seed}`,
            accessLevel: 'read'
          }
        ]
      });
      const baseTransport = new InMemoryVfsCrdtSyncTransport(server);
      const sourceClient = new VfsBackgroundSyncClient(
        'user-1',
        'desktop',
        baseTransport,
        {
          pullLimit: input.pullLimit
        }
      );
      await sourceClient.sync();
      sourceClient.queueLocalOperation({
        opType: 'acl_add',
        opId: localAclOpId,
        itemId: itemLocalAcl,
        principalType,
        principalId: `${principalType}-local-boundary-${input.seed}`,
        accessLevel,
        occurredAt: at(1)
      });
      sourceClient.queueLocalOperation({
        opType: 'link_add',
        opId: localLinkOpId,
        itemId: itemLocalLink,
        parentId: localParentId,
        childId: itemLocalLink,
        occurredAt: at(2)
      });

      const correctedState = sourceClient.exportState();
      const malformedState = sourceClient.exportState();
      const malformedPending = malformedState.pendingOperations[1];
      if (!malformedPending) {
        throw new Error('expected malformed pending operation in boundary run');
      }
      malformedPending.childId = `${itemLocalLink}-mismatch`;

      /**
       * Guardrail harness behavior: append remote changes after checkpoint export
       * so resumed sync must cross both push and pull pagination boundaries while
       * still preserving deterministic forward container windows.
       */
      await server.pushOperations({
        operations: [
          {
            opId: remoteAclOpId,
            opType: 'acl_add',
            itemId: itemRemoteAcl,
            replicaId: 'remote',
            writeId: 2,
            occurredAt: at(3),
            principalType: 'group',
            principalId: `group-remote-boundary-${input.seed}`,
            accessLevel: 'write'
          },
          {
            opId: remoteLinkOpId,
            opType: 'link_add',
            itemId: itemRemoteLink,
            replicaId: 'remote',
            writeId: 3,
            occurredAt: at(4),
            parentId: remoteParentId,
            childId: itemRemoteLink
          }
        ]
      });

      const pulledOpIds: string[] = [];
      const pullCursorSignatures: string[] = [];
      const guardrailViolations: Array<{
        code: string;
        stage: string;
      }> = [];
      const transport: VfsCrdtSyncTransport = {
        pushOperations: (pushInput) => baseTransport.pushOperations(pushInput),
        pullOperations: async (pullInput) => {
          const cursorSignature = pullInput.cursor
            ? `${pullInput.cursor.changedAt}|${pullInput.cursor.changeId}`
            : 'null';
          pullCursorSignatures.push(cursorSignature);
          const response = await baseTransport.pullOperations(pullInput);
          pulledOpIds.push(...response.items.map((item) => item.opId));
          return response;
        },
        reconcileState: async (reconcileInput) => {
          if (baseTransport.reconcileState) {
            return baseTransport.reconcileState(reconcileInput);
          }

          return {
            cursor: reconcileInput.cursor,
            lastReconciledWriteIds: server.snapshot().lastReconciledWriteIds
          };
        }
      };
      const targetClient = new VfsBackgroundSyncClient(
        'user-1',
        'desktop',
        transport,
        {
          pullLimit: input.pullLimit,
          onGuardrailViolation: (violation) => {
            guardrailViolations.push({
              code: violation.code,
              stage: violation.stage
            });
          }
        }
      );

      expect(() => targetClient.hydrateState(malformedState)).toThrow(
        'state.pendingOperations[1] has link childId that does not match itemId'
      );
      expect(() => targetClient.hydrateState(correctedState)).not.toThrow();

      const seedCursor = readSeedContainerCursorOrThrow({
        client: targetClient,
        pageLimit: 20,
        errorMessage: 'expected seed cursor in boundary perturbation run'
      });

      await targetClient.flush();

      const fullWindowSignatures = readForwardContainerSignatures({
        client: targetClient,
        seedCursor,
        pageLimit: 100
      });
      const pagedWindowSignatures = readForwardContainerSignatures({
        client: targetClient,
        seedCursor,
        pageLimit: input.containerWindowLimit
      });
      expect(pagedWindowSignatures).toEqual(fullWindowSignatures);
      expect(fullWindowSignatures).toEqual([
        `${itemLocalAcl}|${localAclOpId}`,
        `${localParentId}|${localLinkOpId}`,
        `${itemRemoteAcl}|${remoteAclOpId}`,
        `${remoteParentId}|${remoteLinkOpId}`
      ]);
      expect(pulledOpIds).toEqual([
        localAclOpId,
        localLinkOpId,
        remoteAclOpId,
        remoteLinkOpId
      ]);
      expect(new Set(pulledOpIds).size).toBe(pulledOpIds.length);
      expect(pulledOpIds).not.toContain(remoteSeedOpId);

      const guardrailSignatures = toStageCodeSignatures(guardrailViolations);
      expect(guardrailSignatures).toEqual([
        'hydrate:hydrateGuardrailViolation'
      ]);

      return {
        forwardSignatures: fullWindowSignatures,
        pulledOpIds,
        pullCursorSignatures,
        guardrailSignatures
      };
    };

    const seeds = [1661, 1662] as const;
    const configs = [
      {
        pullLimit: 1,
        containerWindowLimit: 1
      },
      {
        pullLimit: 1,
        containerWindowLimit: 2
      },
      {
        pullLimit: 2,
        containerWindowLimit: 1
      },
      {
        pullLimit: 3,
        containerWindowLimit: 3
      }
    ] as const;

    for (const seed of seeds) {
      let expectedForwardSignatures: string[] | null = null;
      for (const config of configs) {
        const firstRun = await runScenario({
          seed,
          pullLimit: config.pullLimit,
          containerWindowLimit: config.containerWindowLimit
        });
        const secondRun = await runScenario({
          seed,
          pullLimit: config.pullLimit,
          containerWindowLimit: config.containerWindowLimit
        });
        expect(secondRun).toEqual(firstRun);

        if (!expectedForwardSignatures) {
          expectedForwardSignatures = firstRun.forwardSignatures;
        } else {
          expect(firstRun.forwardSignatures).toEqual(expectedForwardSignatures);
        }
      }
    }
  });
});
