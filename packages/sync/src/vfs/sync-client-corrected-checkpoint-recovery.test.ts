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
  it('recovers with corrected checkpoint payload after malformed pending rejection and preserves push ordering', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    await server.pushOperations({
      operations: [
        {
          opId: 'remote-seed-recovery-1',
          opType: 'acl_add',
          itemId: 'item-seed-recovery-pending',
          replicaId: 'remote',
          writeId: 1,
          occurredAt: '2026-02-14T12:34:00.000Z',
          principalType: 'group',
          principalId: 'group-1',
          accessLevel: 'read'
        }
      ]
    });
    const baseTransport = new InMemoryVfsCrdtSyncTransport(server);
    const sourceClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      baseTransport
    );
    await sourceClient.sync();
    sourceClient.queueLocalOperation({
      opType: 'acl_add',
      opId: 'local-acl-recovery',
      itemId: 'item-local-acl-recovery',
      principalType: 'group',
      principalId: 'group-local-recovery',
      accessLevel: 'write',
      occurredAt: '2026-02-14T12:34:01.000Z'
    });
    sourceClient.queueLocalOperation({
      opType: 'link_add',
      opId: 'local-link-recovery',
      itemId: 'item-local-link-recovery',
      parentId: 'root',
      childId: 'item-local-link-recovery',
      occurredAt: '2026-02-14T12:34:02.000Z'
    });

    const correctedState = sourceClient.exportState();
    const malformedState = sourceClient.exportState();
    const malformedPending = malformedState.pendingOperations[1];
    if (!malformedPending) {
      throw new Error(
        'expected second pending operation to corrupt for recovery'
      );
    }
    malformedPending.childId = 'item-local-link-recovery-mismatch';

    const pushedOpIds: string[] = [];
    const pushedWriteIds: number[] = [];
    const guardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
    }> = [];
    const transport: VfsCrdtSyncTransport = {
      pushOperations: async (input) => {
        pushedOpIds.push(
          ...input.operations.map((operation) => operation.opId)
        );
        pushedWriteIds.push(
          ...input.operations.map((operation) => operation.writeId)
        );
        return baseTransport.pushOperations(input);
      },
      pullOperations: (input) => baseTransport.pullOperations(input)
    };
    const targetClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      transport,
      {
        onGuardrailViolation: (violation) => {
          guardrailViolations.push({
            code: violation.code,
            stage: violation.stage,
            message: violation.message
          });
        }
      }
    );

    expect(() => targetClient.hydrateState(malformedState)).toThrow(
      'state.pendingOperations[1] has link childId that does not match itemId'
    );
    expect(guardrailViolations).toEqual([
      {
        code: 'hydrateGuardrailViolation',
        stage: 'hydrate',
        message:
          'state.pendingOperations[1] has link childId that does not match itemId'
      }
    ]);

    expect(() => targetClient.hydrateState(correctedState)).not.toThrow();
    const seedCursor = readSeedContainerCursorOrThrow({
      client: targetClient,
      pageLimit: 10,
      errorMessage: 'expected seed cursor before corrected recovery flush'
    });

    await targetClient.flush();

    expect(pushedOpIds).toEqual(['local-acl-recovery', 'local-link-recovery']);
    expect(pushedWriteIds).toEqual([1, 2]);
    expect(targetClient.snapshot().pendingOperations).toBe(0);

    const forwardPage = targetClient.listChangedContainers(seedCursor, 10);
    const forwardContainerIds = forwardPage.items.map(
      (item) => item.containerId
    );
    expect(forwardContainerIds).toContain('item-local-acl-recovery');
    expect(forwardContainerIds).toContain('root');
    expect(guardrailViolations).toHaveLength(1);
  });

  it('keeps corrected-checkpoint recovery signatures deterministic across seeds', async () => {
    const runScenario = async (
      seed: number
    ): Promise<{
      pushedOpIds: string[];
      pushedWriteIds: number[];
      pageSignatures: string[];
      guardrailSignatures: string[];
    }> => {
      const random = createDeterministicRandom(seed);
      const parentCandidates = ['root', 'archive', 'workspace'] as const;
      const principalTypes = ['group', 'organization'] as const;
      const accessLevels = ['read', 'write', 'admin'] as const;
      const parentId = pickOne(parentCandidates, random);
      const principalType = pickOne(principalTypes, random);
      const accessLevel = pickOne(accessLevels, random);

      const itemSeed = `item-seed-corrected-${seed}`;
      const itemLocalAcl = `item-local-acl-corrected-${seed}`;
      const itemLocalLink = `item-local-link-corrected-${seed}`;
      const localAclOpId = `local-acl-corrected-${seed}`;
      const localLinkOpId = `local-link-corrected-${seed}`;

      const at = createSeededIsoTimestampFactory({
        baseIso: '2026-02-14T12:35:00.000Z',
        seed
      });

      const server = new InMemoryVfsCrdtSyncServer();
      await server.pushOperations({
        operations: [
          {
            opId: `remote-seed-corrected-${seed}`,
            opType: 'acl_add',
            itemId: itemSeed,
            replicaId: 'remote',
            writeId: 1,
            occurredAt: at(0),
            principalType: 'group',
            principalId: 'group-seed',
            accessLevel: 'read'
          }
        ]
      });
      const baseTransport = new InMemoryVfsCrdtSyncTransport(server);
      const sourceClient = new VfsBackgroundSyncClient(
        'user-1',
        'desktop',
        baseTransport
      );
      await sourceClient.sync();
      sourceClient.queueLocalOperation({
        opType: 'acl_add',
        opId: localAclOpId,
        itemId: itemLocalAcl,
        principalType,
        principalId: `${principalType}-corrected-${seed}`,
        accessLevel,
        occurredAt: at(1)
      });
      sourceClient.queueLocalOperation({
        opType: 'link_add',
        opId: localLinkOpId,
        itemId: itemLocalLink,
        parentId,
        childId: itemLocalLink,
        occurredAt: at(2)
      });

      const correctedState = sourceClient.exportState();
      const malformedState = sourceClient.exportState();
      const malformedPending = malformedState.pendingOperations[1];
      if (!malformedPending) {
        throw new Error(
          'expected second pending operation for correction seed'
        );
      }
      malformedPending.childId = `${itemLocalLink}-mismatch`;

      const pushedOpIds: string[] = [];
      const pushedWriteIds: number[] = [];
      const guardrailViolations: Array<{
        code: string;
        stage: string;
        message: string;
      }> = [];
      const transport: VfsCrdtSyncTransport = {
        pushOperations: async (input) => {
          pushedOpIds.push(
            ...input.operations.map((operation) => operation.opId)
          );
          pushedWriteIds.push(
            ...input.operations.map((operation) => operation.writeId)
          );
          return baseTransport.pushOperations(input);
        },
        pullOperations: (input) => baseTransport.pullOperations(input)
      };
      const targetClient = new VfsBackgroundSyncClient(
        'user-1',
        'desktop',
        transport,
        {
          onGuardrailViolation: (violation) => {
            guardrailViolations.push({
              code: violation.code,
              stage: violation.stage,
              message: violation.message
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
        pageLimit: 10,
        errorMessage: 'expected seed cursor in corrected deterministic run'
      });

      await targetClient.flush();

      const pageSignatures = readForwardContainerSignatures({
        client: targetClient,
        seedCursor,
        pageLimit: 1
      });
      expect(pageSignatures).toEqual([
        `${itemLocalAcl}|${localAclOpId}`,
        `${parentId}|${localLinkOpId}`
      ]);

      expect(pushedOpIds).toEqual([localAclOpId, localLinkOpId]);
      expect(pushedWriteIds).toEqual([1, 2]);
      const guardrailSignatures = toStageCodeSignatures(guardrailViolations);
      expect(guardrailSignatures).toEqual([
        'hydrate:hydrateGuardrailViolation'
      ]);

      return {
        pushedOpIds,
        pushedWriteIds,
        pageSignatures,
        guardrailSignatures
      };
    };

    const seeds = [1551, 1552, 1553] as const;
    for (const seed of seeds) {
      const firstRun = await runScenario(seed);
      const secondRun = await runScenario(seed);
      expect(secondRun).toEqual(firstRun);
    }
  });
});
