import { describe, expect, it } from 'vitest';
import {
  VfsBackgroundSyncClient,
  type VfsCrdtSyncTransport
} from './sync-client.js';
import {
  InMemoryVfsCrdtSyncServer,
  InMemoryVfsCrdtSyncTransport
} from './sync-client-harness.js';

describe('VfsBackgroundSyncClient', () => {
  it('fails closed on malformed queued local op in checkpointed pending state and preserves target paginated windows', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    await server.pushOperations({
      operations: [
        {
          opId: 'remote-seed-1',
          opType: 'acl_add',
          itemId: 'item-seed-malformed-pending',
          replicaId: 'remote',
          writeId: 1,
          occurredAt: '2026-02-14T12:33:00.000Z',
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
      opId: 'local-acl-malformed',
      itemId: 'item-local-acl-malformed',
      principalType: 'group',
      principalId: 'group-local',
      accessLevel: 'write',
      occurredAt: '2026-02-14T12:33:01.000Z'
    });
    sourceClient.queueLocalOperation({
      opType: 'link_add',
      opId: 'local-link-malformed',
      itemId: 'item-local-link-malformed',
      parentId: 'root',
      childId: 'item-local-link-malformed',
      occurredAt: '2026-02-14T12:33:02.000Z'
    });

    const malformedState = sourceClient.exportState();
    const malformedPending = malformedState.pendingOperations[1];
    if (!malformedPending) {
      throw new Error('expected second pending operation to corrupt');
    }
    malformedPending.childId = 'item-local-link-malformed-mismatch';

    let pushedOperationCount = 0;
    const guardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
    }> = [];
    const transport: VfsCrdtSyncTransport = {
      pushOperations: async (input) => {
        pushedOperationCount += input.operations.length;
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
    const pristineState = targetClient.exportState();
    const pristineFirstPage = targetClient.listChangedContainers(null, 1);
    const pristineSecondPage = targetClient.listChangedContainers(
      pristineFirstPage.nextCursor,
      1
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
    expect(targetClient.exportState()).toEqual(pristineState);
    expect(targetClient.listChangedContainers(null, 1)).toEqual(
      pristineFirstPage
    );
    expect(
      targetClient.listChangedContainers(pristineFirstPage.nextCursor, 1)
    ).toEqual(pristineSecondPage);
    expect(pushedOperationCount).toBe(0);
  });
});
