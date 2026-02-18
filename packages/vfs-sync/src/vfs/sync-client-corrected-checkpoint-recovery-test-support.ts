import {
  VfsBackgroundSyncClient,
  type VfsCrdtSyncTransport,
  type VfsSyncGuardrailViolation
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
  readSeedContainerCursorOrThrow
} from './sync-client-randomized-test-support.js';

export interface CorrectedCheckpointRecoveryResult {
  expectedPushedOpIds: string[];
  expectedPushedWriteIds: number[];
  pushedOpIds: string[];
  pushedWriteIds: number[];
  forwardContainerIds: string[];
  pendingOperationsCount: number;
  malformedHydrateError: string | null;
  guardrailViolations: VfsSyncGuardrailViolation[];
}

export interface CorrectedCheckpointDeterministicResult {
  expectedPushedOpIds: string[];
  expectedPushedWriteIds: number[];
  expectedPageSignatures: string[];
  pushedOpIds: string[];
  pushedWriteIds: number[];
  pageSignatures: string[];
  malformedHydrateError: string | null;
  guardrailViolations: VfsSyncGuardrailViolation[];
}

export async function runCorrectedCheckpointRecoveryScenario(): Promise<CorrectedCheckpointRecoveryResult> {
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
  const guardrailViolations: VfsSyncGuardrailViolation[] = [];

  const transport: VfsCrdtSyncTransport = {
    pushOperations: async (input) => {
      pushedOpIds.push(...input.operations.map((operation) => operation.opId));
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
        guardrailViolations.push(violation);
      }
    }
  );

  let malformedHydrateError: string | null = null;
  try {
    targetClient.hydrateState(malformedState);
  } catch (error) {
    malformedHydrateError =
      error instanceof Error ? error.message : String(error);
  }

  targetClient.hydrateState(correctedState);

  const seedCursor = readSeedContainerCursorOrThrow({
    client: targetClient,
    pageLimit: 10,
    errorMessage: 'expected seed cursor before corrected recovery flush'
  });

  await targetClient.flush();

  const forwardContainerIds = targetClient
    .listChangedContainers(seedCursor, 10)
    .items.map((item) => item.containerId);

  return {
    expectedPushedOpIds: ['local-acl-recovery', 'local-link-recovery'],
    expectedPushedWriteIds: [1, 2],
    pushedOpIds,
    pushedWriteIds,
    forwardContainerIds,
    pendingOperationsCount: targetClient.snapshot().pendingOperations,
    malformedHydrateError,
    guardrailViolations
  };
}

export async function runCorrectedCheckpointDeterministicScenario(
  seed: number
): Promise<CorrectedCheckpointDeterministicResult> {
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
    throw new Error('expected second pending operation for correction seed');
  }
  malformedPending.childId = `${itemLocalLink}-mismatch`;

  const pushedOpIds: string[] = [];
  const pushedWriteIds: number[] = [];
  const guardrailViolations: VfsSyncGuardrailViolation[] = [];

  const transport: VfsCrdtSyncTransport = {
    pushOperations: async (input) => {
      pushedOpIds.push(...input.operations.map((operation) => operation.opId));
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
        guardrailViolations.push(violation);
      }
    }
  );

  let malformedHydrateError: string | null = null;
  try {
    targetClient.hydrateState(malformedState);
  } catch (error) {
    malformedHydrateError =
      error instanceof Error ? error.message : String(error);
  }

  targetClient.hydrateState(correctedState);

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

  return {
    expectedPushedOpIds: [localAclOpId, localLinkOpId],
    expectedPushedWriteIds: [1, 2],
    expectedPageSignatures: [
      `${itemLocalAcl}|${localAclOpId}`,
      `${parentId}|${localLinkOpId}`
    ],
    pushedOpIds,
    pushedWriteIds,
    pageSignatures,
    malformedHydrateError,
    guardrailViolations
  };
}
