import { expect, test } from "bun:test";
import { createMockApiClient, createTestExecSql } from "@symcrypt/test-utils";
import {
  createMutationResponseFromRequest,
  createParentProjection,
  createParentProjectionUserKeyResolver,
} from "../../../../test/helpers/containerFixtures";
import { createResponseFromRequest } from "../../../../test/helpers/documentFixtures";
import { createMemoryBlobStore } from "../../../data/blobs/memoryBlobStore";
import { createContainerMetadataDocument } from "../../../data/containers/containerMetadataDocument";
import { defaultDocumentProjectorRegistry } from "../../../data/documents/documentKinds";
import { createDomainScope } from "../../../data/domainScope";
import { ContainerCreateIntentSupersededError } from "../../../data/persistence/container-contents/containerIntentPersistence";
import {
  type ContainerCreateIntentRecord,
  defaultContainerContentsPersistence,
} from "../containerPersistence";
import { createContainerContentsWorkflowRuntime } from "../runtime";
import { createTestContainerState } from "./containerState.testFixtures";
import { syncPendingContainerCreateIntents } from "./createIntentSync";
import type { ContainerCreateIntentSyncState } from "./types";

async function runCreatePersistenceOutcome(
  persistenceStatus:
    | "deleted-during-settlement"
    | "identity-superseded"
    | "intent-superseded"
    | "missing"
    | "planning-stale"
    | "response-stale"
    | "settlement-stale"
    | "stale-generation",
) {
  const parent = await createParentProjection();
  const parentContainerId = parent.projection.containerId;
  const childContainerId = `child-${persistenceStatus}-during-create-persist`;
  const { close, execSql } = await createTestExecSql(
    `container-create-intent-${persistenceStatus}-race`,
  );
  const deletedRemoteIds: string[] = [];
  let remoteCreateCount = 0;
  const apiClient = createMockApiClient({
    createContainerWithMetadataDocument: async (request) => {
      remoteCreateCount += 1;
      const response = {
        container: await createMutationResponseFromRequest(request.container),
        metadataDocument: await createResponseFromRequest(
          request.metadataDocument,
        ),
      };
      if (persistenceStatus === "response-stale") current = false;
      return response;
    },
    deleteContainer: async (containerId) => {
      deletedRemoteIds.push(containerId);
      return {
        containerId,
        deletedAt: "2026-08-24T00:00:00.000Z",
      };
    },
    getContainerWriterProjection: async (containerId) => {
      if (
        persistenceStatus === "planning-stale" &&
        containerId === parentContainerId
      ) {
        current = false;
      }
      return containerId === parentContainerId ? parent.projection : null;
    },
  });
  const runtime = createContainerContentsWorkflowRuntime({
    apiClient,
    auth: {
      isAuthenticated: true,
      organizationId: parent.projection.organizationId,
      userId: parent.userId,
    },
    crypto: {
      encapsulationKeyPair: {
        publicKey: parent.encapsulationPublicKey,
        secretKey: parent.secretKey,
      },
      signingFingerprint: parent.author.signerKeyFingerprint,
      signingKeyPair: {
        signingPrivateKey: parent.author.signerPrivateKey,
        signingPublicKey: parent.signingPublicKey,
      },
    },
    infra: {
      blobStore: createMemoryBlobStore(),
      dbStatus: "ready",
      documentProjectors: defaultDocumentProjectorRegistry,
      execSql,
    },
    resolveTrustedUserIdentity: async () => null,
    state: {
      containerId: parentContainerId,
      domainScope: createDomainScope(),
      events: [],
      online: true,
    },
    util: {
      log: () => undefined,
      reportSecurityIncident: async () => undefined,
    },
  });
  const intent: ContainerCreateIntentRecord = {
    containerId: childContainerId,
    createdAt: "2026-08-24T00:00:00.000Z",
    id: `create-${persistenceStatus}-child`,
    intentType: "container.create",
    lastAttemptedAt: null,
    lastError: null,
    parentContainerId,
    remoteContainerId: null,
    remoteMetadataAccessStateHash: null,
    remoteMetadataDocumentId: null,
    syncStatus: "pending",
    updatedAt: "2026-08-24T00:00:00.000Z",
  };
  const syncedIntents: string[] = [];
  const reconciliationRequests: Array<string | null> = [];
  let current = true;
  let deleteContainerFromState = () => undefined;
  const persistence: ContainerCreateIntentSyncState["persistence"] = {
    ...defaultContainerContentsPersistence,
    listPendingCreateIntents: async () => [intent],
    markCreateIntentSynced: async (_execSql, input) => {
      syncedIntents.push(input.containerId);
      if (persistenceStatus === "settlement-stale") current = false;
      if (persistenceStatus === "deleted-during-settlement") {
        deleteContainerFromState();
        return false;
      }
      if (persistenceStatus === "intent-superseded") return false;
      return input.stillCurrent();
    },
  };
  const parentState = createTestContainerState({
    id: parentContainerId,
    parentId: "root",
    synced: true,
  });
  parentState.container.organizationId = parent.projection.organizationId;
  const childState = createTestContainerState({
    id: childContainerId,
    parentId: parentContainerId,
    synced: false,
  });
  childState.doc = await createContainerMetadataDocument(childContainerId);
  const originalContainer = { ...childState.container };
  const containersById = new Map([
    [childContainerId, childState],
    [parentContainerId, parentState],
  ]);
  deleteContainerFromState = () => {
    containersById.delete(childContainerId);
  };
  const state: ContainerCreateIntentSyncState = {
    containersById,
    persistence,
    resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
    runtime,
  };

  try {
    const host: Parameters<
      typeof syncPendingContainerCreateIntents
    >[0]["host"] = {
      persistContainerState: async () => {
        if (persistenceStatus === "missing") return { status: "missing" };
        if (persistenceStatus === "stale-generation") {
          return { status: "stale-generation" };
        }
        if (persistenceStatus === "deleted-during-settlement") {
          deleteContainerFromState();
          return { status: "missing" };
        }
        if (persistenceStatus === "settlement-stale") {
          current = false;
          return { status: "stale-generation" };
        }
        if (persistenceStatus === "intent-superseded") {
          throw new ContainerCreateIntentSupersededError();
        }
        return {
          record: childState.record,
          status: "identity-superseded",
        };
      },
    };
    const createdCount = await syncPendingContainerCreateIntents({
      host,
      isCurrent: () => current,
      isRemoteSyncBlocked: () => false,
      requestRemoteReconciliation: (parentId) => {
        reconciliationRequests.push(parentId);
      },
      state,
    });
    return {
      childContainerId,
      childState,
      createdCount,
      deletedRemoteIds,
      originalContainer,
      reconciliationRequests,
      remoteCreateCount,
      syncedIntents,
    };
  } finally {
    close();
  }
}

test("create persistence discards only when the local container is missing", async () => {
  const missing = await runCreatePersistenceOutcome("missing");
  expect(missing.createdCount).toBe(0);
  expect(missing.deletedRemoteIds).toEqual([missing.childContainerId]);
  expect(missing.syncedIntents).toEqual([]);

  // Another pane persisted an authoritative remote identity while this
  // response was in flight. The create remains pending for hydration, but its
  // valid remote container must not be deleted.
  const superseded = await runCreatePersistenceOutcome("identity-superseded");
  expect(superseded.createdCount).toBe(0);
  expect(superseded.deletedRemoteIds).toEqual([]);
  expect(superseded.syncedIntents).toEqual([]);
});

test("a stale create settlement leaves the live container projection unchanged", async () => {
  const stale = await runCreatePersistenceOutcome("stale-generation");

  expect(stale.createdCount).toBe(0);
  expect(stale.childState.container).toEqual(stale.originalContainer);
  expect(stale.syncedIntents).toEqual([]);
  expect(stale.reconciliationRequests).toEqual([
    stale.childState.container.parentId,
  ]);
});

test("a generation change after remote create requests replacement hydration", async () => {
  const stale = await runCreatePersistenceOutcome("response-stale");

  expect(stale.createdCount).toBe(0);
  expect(stale.childState.container).toEqual(stale.originalContainer);
  expect(stale.syncedIntents).toEqual([]);
  expect(stale.reconciliationRequests).toEqual([
    stale.childState.container.parentId,
  ]);
});

test("a generation change during create planning prevents the remote create", async () => {
  const stale = await runCreatePersistenceOutcome("planning-stale");

  expect(stale.createdCount).toBe(0);
  expect(stale.remoteCreateCount).toBe(0);
  expect(stale.childState.container).toEqual(stale.originalContainer);
});

test("a generation change during create intent settlement leaves the live projection unchanged", async () => {
  const stale = await runCreatePersistenceOutcome("settlement-stale");

  expect(stale.createdCount).toBe(0);
  expect(stale.childState.container).toEqual(stale.originalContainer);
  expect(stale.syncedIntents).toEqual([]);
  expect(stale.reconciliationRequests).toEqual([
    stale.childState.container.parentId,
  ]);
});

test("an overtaking create intent prevents stale live-state installation", async () => {
  const overtaken = await runCreatePersistenceOutcome("intent-superseded");

  expect(overtaken.createdCount).toBe(0);
  expect(overtaken.childState.container).toEqual(overtaken.originalContainer);
  expect(overtaken.syncedIntents).toEqual([]);
  expect(overtaken.deletedRemoteIds).toEqual([]);
});

test("a local delete during create settlement discards the remote container", async () => {
  const deleted = await runCreatePersistenceOutcome(
    "deleted-during-settlement",
  );

  expect(deleted.createdCount).toBe(0);
  expect(deleted.deletedRemoteIds).toEqual([deleted.childContainerId]);
  expect(deleted.syncedIntents).toEqual([]);
});
