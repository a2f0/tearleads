import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import {
  createContainerMutationResponseFromRequest,
  createContainerWriterProjectionFixture,
  createMockApiClient,
  createTestExecSql,
} from "@tearleads/test-utils";
import { createAuthor } from "../../../../test/helpers/documentFixturePrimitives";
import { createTestTrustedUserIdentityResolver } from "../../../../test/helpers/trustedUserIdentity";
import { createContainerMetadataDocument } from "../../../data/containers/containerMetadataDocument";
import { createDomainScope } from "../../../data/shared/domainScope";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import {
  type ContainerMoveIntentRecord,
  defaultContainerContentsPersistence,
} from "../containerPersistence";
import type { ContainerState } from "../remoteHydration";
import { createTestContainerState } from "./containerState.testFixtures";
import {
  persistAcceptedMoveIntent,
  syncPendingContainerMoveIntents,
} from "./moveIntentSync";
import type {
  ContainerMoveIntentSyncHost,
  ContainerMoveIntentSyncState,
} from "./types";

test("an overtaking move intent prevents stale live-state installation", async () => {
  const child = createTestContainerState({ id: "child", parentId: "root" });
  child.doc = await createContainerMetadataDocument(child.container.id);
  const originalContainer = { ...child.container };
  const persistence = defaultContainerContentsPersistence;
  const execSql: ExecSql = async () => [];
  const state = {
    containersById: new Map([["child", child]]),
    persistence,
    resolveProjectionUserKey: async () => null,
    runtime: {
      apiClient: { getCurrentPrincipalPolicy: async () => null },
      infra: { execSql },
      resolveTrustedUserIdentity: async () => null,
      util: {
        log: () => {},
        reportSecurityIncident: async () => {},
      },
    },
  } as unknown as ContainerMoveIntentSyncState;
  const intent: ContainerMoveIntentRecord = {
    containerId: "child",
    createdAt: "2026-05-31T00:00:00.000Z",
    id: "intent-child",
    intentType: "container.move",
    lastAttemptedAt: null,
    lastError: null,
    parentContainerId: "parent",
    previousParentContainerId: "root",
    syncStatus: "pending",
    updatedAt: "2026-05-31T00:00:00.000Z",
  };

  await expect(
    persistAcceptedMoveIntent({
      host: {
        persistContainerState: async (
          _candidate,
          _patch,
          _updateView,
          _saveOptions,
          mutationOptions,
        ) => {
          expect(mutationOptions?.moveIntentSettlement).toEqual({
            containerId: intent.containerId,
            expectedIntentId: intent.id,
            expectedUpdatedAt: intent.updatedAt,
          });
          throw new Error(
            "Container move intent was superseded before local settlement",
          );
        },
        updateSnapshot: () => {},
      },
      isCurrent: () => true,
      intent,
      moved: {
        createdAt: "2026-05-31T00:00:00.000Z",
        effectiveAccessLevel: "admin",
        id: "child",
        metadataAccessEpoch: 2,
        metadataAccessStateHash: "access-after-move",
        metadataDocumentId: "metadata-after-move",
        metadataReferencedPrincipals: [],
        organizationId: "organization",
        parentId: "parent",
        updatedAt: "2026-05-31T00:01:00.000Z",
      },
      requestRemoteReconciliation: () => {},
      state,
    }),
  ).rejects.toThrow("superseded before local settlement");
  expect(child.container).toEqual(originalContainer);
});

test("a generation change in the commit acknowledgment leaves live state unchanged", async () => {
  const child = createTestContainerState({ id: "child", parentId: "root" });
  child.doc = await createContainerMetadataDocument(child.container.id);
  const originalContainer = { ...child.container };
  const reconciledParentIds: Array<string | null> = [];
  let current = true;
  const persistence = defaultContainerContentsPersistence;
  const execSql: ExecSql = async () => [];
  const state = {
    containersById: new Map([["child", child]]),
    persistence,
    resolveProjectionUserKey: async () => null,
    runtime: {
      apiClient: { getCurrentPrincipalPolicy: async () => null },
      infra: { execSql },
      resolveTrustedUserIdentity: async () => null,
      util: { log: () => {}, reportSecurityIncident: async () => {} },
    },
  } as unknown as ContainerMoveIntentSyncState;
  const intent: ContainerMoveIntentRecord = {
    containerId: "child",
    createdAt: "2026-05-31T00:00:00.000Z",
    id: "intent-child",
    intentType: "container.move",
    lastAttemptedAt: null,
    lastError: null,
    parentContainerId: "parent",
    previousParentContainerId: "root",
    syncStatus: "pending",
    updatedAt: "2026-05-31T00:00:00.000Z",
  };

  expect(
    await persistAcceptedMoveIntent({
      host: {
        persistContainerState: async (
          _candidate,
          _patch,
          _updateView,
          _saveOptions,
          mutationOptions,
        ) => {
          expect(mutationOptions?.moveIntentSettlement).toEqual({
            containerId: intent.containerId,
            expectedIntentId: intent.id,
            expectedUpdatedAt: intent.updatedAt,
          });
          return {
            get moveIntentSettled(): true {
              current = false;
              return true;
            },
            record: child.record,
            status: "persisted",
          };
        },
        updateSnapshot: () => {},
      },
      isCurrent: () => current,
      intent,
      moved: {
        createdAt: "2026-05-31T00:00:00.000Z",
        effectiveAccessLevel: "admin",
        id: "child",
        metadataAccessEpoch: 2,
        metadataAccessStateHash: "access-after-move",
        metadataDocumentId: "metadata-after-move",
        metadataReferencedPrincipals: [],
        organizationId: "organization",
        parentId: "parent",
        updatedAt: "2026-05-31T00:01:00.000Z",
      },
      requestRemoteReconciliation: (parentId) => {
        reconciledParentIds.push(parentId);
      },
      state,
    }),
  ).toBe(false);
  expect(reconciledParentIds).toEqual(["parent"]);
  expect(child.container).toEqual(originalContainer);
});

test("move persistence rejects a save without atomic intent settlement", async () => {
  const child = createTestContainerState({ id: "child", parentId: "root" });
  child.doc = await createContainerMetadataDocument(child.container.id);
  const revisionSettlements: Array<
    Parameters<
      NonNullable<
        ContainerMoveIntentSyncState["persistence"]["markMoveIntentRevisionSynced"]
      >
    >[1]
  > = [];
  const persistence: ContainerMoveIntentSyncState["persistence"] = {
    ...defaultContainerContentsPersistence,
    commitMetadataMutation: async (_execSql, mutation) => ({
      committed: true,
      container: mutation.container,
    }),
    markMoveIntentRevisionSynced: async (_execSql, settlement) => {
      revisionSettlements.push(settlement);
      return true;
    },
  };
  const execSql: ExecSql = async () => [];
  const state = {
    containersById: new Map([["child", child]]),
    persistence,
    resolveProjectionUserKey: async () => null,
    runtime: {
      apiClient: { getCurrentPrincipalPolicy: async () => null },
      infra: { execSql },
      resolveTrustedUserIdentity: async () => null,
      util: { log: () => {}, reportSecurityIncident: async () => {} },
    },
  } as unknown as ContainerMoveIntentSyncState;
  const intent: ContainerMoveIntentRecord = {
    containerId: "child",
    createdAt: "2026-05-31T00:00:00.000Z",
    id: "intent-child",
    intentType: "container.move",
    lastAttemptedAt: null,
    lastError: null,
    parentContainerId: "parent",
    previousParentContainerId: "root",
    syncStatus: "pending",
    updatedAt: "2026-05-31T00:00:00.000Z",
  };
  const moved = {
    createdAt: "2026-05-31T00:00:00.000Z",
    effectiveAccessLevel: "admin" as const,
    id: "child",
    metadataAccessEpoch: 2,
    metadataAccessStateHash: "access-after-move",
    metadataDocumentId: "metadata-after-move",
    metadataReferencedPrincipals: [],
    organizationId: "organization",
    parentId: "parent",
    updatedAt: "2026-05-31T00:01:00.000Z",
  };
  await expect(
    persistAcceptedMoveIntent({
      host: {
        persistContainerState: async (candidate) => ({
          record: candidate.record,
          status: "persisted",
        }),
        updateSnapshot: () => {},
      },
      isCurrent: () => true,
      intent,
      moved,
      requestRemoteReconciliation: () => {},
      state,
    }),
  ).rejects.toThrow(
    "Container move persistence must settle the intent atomically",
  );
  expect(revisionSettlements).toHaveLength(0);
  expect(child.container.parentId).toBe("root");

  expect(
    await persistAcceptedMoveIntent({
      host: {
        persistContainerState: async (candidate) => ({
          moveIntentSettled: true,
          record: candidate.record,
          status: "persisted",
        }),
        updateSnapshot: () => {},
      },
      isCurrent: () => true,
      intent,
      moved,
      requestRemoteReconciliation: () => {},
      state,
    }),
  ).toBe(true);
  expect(revisionSettlements).toHaveLength(0);
});

/**
 * Replays one queued move of `moved` from root into `destination` against a
 * server that accepts it, then lets the scenario lose the result.
 */
async function replayAcceptedMove(input: {
  host: ContainerMoveIntentSyncHost;
  /** Flips once the server has accepted the move. */
  staleAfterAcceptance: boolean;
}) {
  const { author, signingPublicKey } = await createAuthor();
  const kem = generateKemSeedAndKeyPair();
  const signer = {
    encapsulationPublicKey: kem.publicKey,
    organizationId: author.organizationId,
    signerDeviceId: author.signerDeviceId,
    signerKeyFingerprint: author.signerKeyFingerprint,
    signerPrivateKey: author.signerPrivateKey,
    userId: author.signerUserId,
  };
  const root = await createContainerWriterProjectionFixture({
    ...signer,
    containerId: "root",
  });
  const [moved, destination] = await Promise.all(
    ["moved", "destination"].map((containerId) =>
      createContainerWriterProjectionFixture({
        ...signer,
        containerId,
        parentProjection: root,
      }),
    ),
  );
  if (!moved || !destination) throw new Error("Expected signed fixtures");
  const database = await createTestExecSql("container-move-accepted-reports");
  const containerState = (id: string, parentId: string | null) =>
    createTestContainerState({
      id,
      organizationId: author.organizationId,
      parentId,
    });
  const movedLocally = containerState("moved", "destination");
  movedLocally.doc = await createContainerMetadataDocument("moved");
  await defaultContainerContentsPersistence.ensureSchema(database.execSql);
  await defaultContainerContentsPersistence.saveContainer(
    database.execSql,
    movedLocally.container,
    movedLocally.record,
    {
      moveIntent: {
        parentContainerId: "destination",
        previousParentContainerId: "root",
      },
    },
  );
  let current = true;
  let submissions = 0;
  const reconciled: (string | null)[] = [];
  const reports: { error: unknown; message: string }[] = [];
  const state: ContainerMoveIntentSyncState = {
    containersById: new Map<string, ContainerState>([
      ["root", containerState("root", null)],
      ["destination", containerState("destination", "root")],
      ["moved", movedLocally],
    ]),
    persistence: defaultContainerContentsPersistence,
    resolveProjectionUserKey: createTestTrustedUserIdentityResolver({
      encapsulationPublicKey: kem.publicKey,
      signingKeyFingerprint: author.signerKeyFingerprint,
      signingPublicKey,
      userId: author.signerUserId,
    }),
    runtime: {
      apiClient: createMockApiClient({
        getContainerWriterProjection: async (id) =>
          id === "moved" ? moved : destination,
        moveContainerResult: async (_id, request) => {
          submissions += 1;
          const data = await createContainerMutationResponseFromRequest(
            request,
            moved,
            [...root.path, ...destination.path],
          );
          if (input.staleAfterAcceptance) current = false;
          return { data, ok: true as const };
        },
      }),
      auth: {
        isAuthenticated: true,
        organizationId: author.organizationId,
        userId: author.signerUserId,
      },
      crypto: {
        encapsulationKeyPair: kem,
        signingFingerprint: author.signerKeyFingerprint,
        signingKeyPair: {
          signingPrivateKey: author.signerPrivateKey,
          signingPublicKey,
        },
      },
      infra: {
        blobStore:
          {} as ContainerMoveIntentSyncState["runtime"]["infra"]["blobStore"],
        dbStatus: "ready",
        documentProjectors:
          {} as ContainerMoveIntentSyncState["runtime"]["infra"]["documentProjectors"],
        execSql: database.execSql,
      },
      resolveTrustedUserIdentity: async () => null,
      state: {
        containerId: "root",
        domainScope: createDomainScope(),
        events: [],
        online: true,
      },
      util: {
        log: () => {},
        logError: (message, error) => {
          reports.push({ error, message: String(message) });
        },
        reportSecurityIncident: async () => {},
      },
    },
  };
  try {
    const movedCount = await syncPendingContainerMoveIntents({
      host: input.host,
      isCreatePending: () => false,
      isCurrent: () => current,
      isRemoteSyncBlocked: () => false,
      requestRemoteReconciliation: (parentId) => {
        reconciled.push(parentId);
      },
      state,
    });
    const queued =
      await defaultContainerContentsPersistence.listUnsyncedMoveIntents(
        database.execSql,
      );
    return { movedCount, queued, reconciled, reports, submissions };
  } finally {
    database.close();
  }
}

const unusedHost: ContainerMoveIntentSyncHost = {
  persistContainerState: async () => {
    throw new Error("a stale pass must not persist");
  },
  updateSnapshot: () => {},
};

test("a stale pass that drops an accepted move reports it once", async () => {
  const outcome = await replayAcceptedMove({
    host: unusedHost,
    staleAfterAcceptance: true,
  });
  expect(outcome.submissions).toBe(1);
  expect(outcome.movedCount).toBe(0);
  // The next pass re-posts the move the server already holds.
  expect(outcome.queued).toHaveLength(1);
  expect(outcome.reconciled).toEqual(["destination"]);
  expect(outcome.reports.map(({ message }) => message)).toEqual([
    "Container contents: a stale sync pass dropped an accepted container move",
  ]);
  expect(outcome.reports[0]?.error).toBeInstanceOf(Error);
}, 30_000);

test("an accepted move that fails to persist reports it once", async () => {
  const outcome = await replayAcceptedMove({
    host: {
      persistContainerState: async () => ({ status: "missing" }),
      updateSnapshot: () => {},
    },
    staleAfterAcceptance: false,
  });
  expect(outcome.submissions).toBe(1);
  expect(outcome.movedCount).toBe(0);
  expect(outcome.queued).toHaveLength(1);
  expect(outcome.reports.map(({ message }) => message)).toEqual([
    "Container contents: an accepted container move did not persist",
  ]);
}, 30_000);
