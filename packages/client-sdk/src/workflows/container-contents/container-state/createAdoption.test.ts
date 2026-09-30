import { expect, test } from "bun:test";
import { KeyingVerificationError } from "@tearleads/crypto";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import {
  createParentProjection,
  createParentProjectionUserKeyResolver,
} from "../../../../test/helpers/containerFixtures";
import { createMemoryBlobStore } from "../../../data/blobs/memoryBlobStore";
import { defaultDocumentProjectorRegistry } from "../../../data/documents/documentKinds";
import { createDomainScope } from "../../../data/domainScope";
import {
  buildMaterializedContainerCreatePlan,
  childContainerWriterProjectionFromCreatePlan,
} from "../../containers/child/create";
import {
  type ContainerCreateIntentRecord,
  defaultContainerContentsPersistence,
} from "../containerPersistence";
import { createContainerContentsWorkflowRuntime } from "../runtime";
import { createTestContainerState } from "./containerState.testFixtures";
import { syncPendingContainerCreateIntents } from "./createIntentSync";
import type { ContainerCreateIntentSyncState } from "./types";

// A pending create whose container a listing already carries is adopted only
// when the signed epoch-1 create is this user's, under the intended parent
// (#2365 finding 26).

async function adoptListedContainer(input: {
  readonly intendedParent?: "same" | "other";
  readonly sessionUser?: "creator" | "another";
}) {
  const parent = await createParentProjection();
  const parentContainerId = parent.projection.containerId;
  const child = childContainerWriterProjectionFromCreatePlan({
    materializedPlan: await buildMaterializedContainerCreatePlan({
      author: parent.author,
      parentProjection: parent.projection,
      parentSecretKey: parent.secretKey,
      trustedLocalProjection: true,
    }),
    parentProjection: parent.projection,
  });
  const intendedParentId =
    input.intendedParent === "other" ? crypto.randomUUID() : parentContainerId;
  const { close, execSql } = await createTestExecSql(
    `container-create-adoption-${crypto.randomUUID()}`,
  );
  const incidents: string[] = [];
  const runtime = createContainerContentsWorkflowRuntime({
    apiClient: createMockApiClient({
      getContainerWriterProjection: async (containerId: string) =>
        containerId === child.containerId ? child : null,
    }),
    auth: {
      isAuthenticated: true,
      organizationId: parent.projection.organizationId,
      userId: input.sessionUser === "another" ? "another-user" : parent.userId,
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
      reportSecurityIncident: async (_error, context) => {
        incidents.push(context.operation);
      },
    },
  });
  // Hydration has already installed the listed container's remote metadata.
  const childState = createTestContainerState({
    id: child.containerId,
    parentId: intendedParentId,
    synced: false,
  });
  childState.record.documentId = `metadata-${child.containerId}`;
  childState.record.accessStateHash = `access-${child.containerId}`;
  childState.container.metadataDocumentId = `metadata-${child.containerId}`;
  const parentState = createTestContainerState({
    id: intendedParentId,
    parentId: "root",
    synced: true,
  });
  parentState.container.organizationId = parent.projection.organizationId;
  const intent: ContainerCreateIntentRecord = {
    containerId: child.containerId,
    createdAt: "2026-09-30T00:00:00.000Z",
    id: "create-child",
    intentType: "container.create",
    lastAttemptedAt: null,
    lastError: null,
    parentContainerId: intendedParentId,
    remoteContainerId: null,
    remoteMetadataAccessStateHash: null,
    remoteMetadataDocumentId: null,
    syncStatus: "pending",
    updatedAt: "2026-09-30T00:00:00.000Z",
  };
  const recordedErrors: string[] = [];
  const syncedIntents: string[] = [];
  const state: ContainerCreateIntentSyncState = {
    containersById: new Map([
      [child.containerId, childState],
      [intendedParentId, parentState],
    ]),
    persistence: {
      ...defaultContainerContentsPersistence,
      listPendingCreateIntents: async () => [intent],
      recordCreateIntentRevisionError: async (_execSql, error) => {
        recordedErrors.push(error.message);
      },
      markCreateIntentRevisionSynced: async (_execSql, synced) => {
        syncedIntents.push(synced.containerId);
        return true;
      },
    },
    resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
    runtime,
  };
  try {
    const created = await syncPendingContainerCreateIntents({
      host: {
        persistContainerState: async () => {
          throw new Error("an adopted container is never re-created");
        },
      },
      isCurrent: () => true,
      isRemoteSyncBlocked: () => false,
      requestRemoteReconciliation: () => undefined,
      state,
    }).catch((error: unknown) => error);
    return { created, incidents, recordedErrors, syncedIntents };
  } finally {
    close();
  }
}

test("a listed container this user created is adopted", async () => {
  const result = await adoptListedContainer({});

  expect(result.created).toBe(1);
  expect(result.syncedIntents).toHaveLength(1);
  expect(result.recordedErrors).toEqual([]);
});

test("a listed container another user created is refused as an incident", async () => {
  const result = await adoptListedContainer({ sessionUser: "another" });

  expect(result.created).toBeInstanceOf(KeyingVerificationError);
  expect(result.created).toMatchObject({ code: "signer_mismatch" });
  expect(result.incidents).toEqual(["container.create.replay"]);
  expect(result.syncedIntents).toEqual([]);
});

test("a listed container created under another parent is refused", async () => {
  const result = await adoptListedContainer({ intendedParent: "other" });

  expect(result.created).toBeInstanceOf(KeyingVerificationError);
  expect(result.created).toMatchObject({ code: "object_mismatch" });
  expect(result.syncedIntents).toEqual([]);
});
