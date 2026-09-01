import { expect, test } from "bun:test";
import { createContainerMetadataDocument } from "../../../data/containers/containerMetadataDocument";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import {
  type ContainerMoveIntentRecord,
  defaultContainerContentsPersistence,
} from "../containerPersistence";
import { createTestContainerState } from "./containerState.testFixtures";
import { persistAcceptedMoveIntent } from "./moveIntentSync";
import type { ContainerMoveIntentSyncState } from "./types";

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

test("a generation change during settlement leaves live state unchanged", async () => {
  const child = createTestContainerState({ id: "child", parentId: "root" });
  child.doc = await createContainerMetadataDocument(child.container.id);
  const originalContainer = { ...child.container };
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
          current = false;
          return { status: "stale-generation" };
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
      requestRemoteReconciliation: () => {},
      state,
    }),
  ).toBe(false);
  expect(child.container).toEqual(originalContainer);
});

test("move settlement requires an atomic result or revision-CAS capability", async () => {
  const child = createTestContainerState({ id: "child", parentId: "root" });
  child.doc = await createContainerMetadataDocument(child.container.id);
  const revisionSettlements: Array<
    Parameters<
      NonNullable<
        ContainerMoveIntentSyncState["persistence"]["markMoveIntentRevisionSynced"]
      >
    >[1]
  > = [];
  let legacySettlementCalls = 0;
  const persistence: ContainerMoveIntentSyncState["persistence"] = {
    ...defaultContainerContentsPersistence,
    commitMetadataMutation: async (_execSql, mutation) => ({
      committed: true,
      container: mutation.container,
    }),
    markMoveIntentRevisionSynced: undefined,
    markMoveIntentSynced: async () => {
      legacySettlementCalls += 1;
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
  const reconciliationRequests: Array<string | null> = [];

  expect(
    await persistAcceptedMoveIntent({
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
      requestRemoteReconciliation: (parentId) => {
        reconciliationRequests.push(parentId);
      },
      state,
    }),
  ).toBe(false);
  expect(legacySettlementCalls).toBe(0);
  expect(reconciliationRequests).toEqual(["parent"]);
  expect(child.container.parentId).toBe("root");

  persistence.markMoveIntentRevisionSynced = async (_execSql, settlement) => {
    revisionSettlements.push(settlement);
    return true;
  };
  expect(
    await persistAcceptedMoveIntent({
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
  ).toBe(true);
  expect(revisionSettlements).toHaveLength(1);
  expect(revisionSettlements[0]).toMatchObject({
    containerId: intent.containerId,
    expectedIntentId: intent.id,
    expectedUpdatedAt: intent.updatedAt,
  });
  expect(revisionSettlements[0]?.stillCurrent()).toBe(true);
  expect(child.container.parentId).toBe("parent");

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
  expect(revisionSettlements).toHaveLength(1);
});
