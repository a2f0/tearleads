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
  const persistence: ContainerMoveIntentSyncState["persistence"] = {
    ...defaultContainerContentsPersistence,
    markMoveIntentSynced: async () => false,
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
        persistContainerState: async () => ({
          record: child.record,
          status: "persisted",
        }),
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
      state,
    }),
  ).resolves.toBe(false);
  expect(child.container).toEqual(originalContainer);
});
