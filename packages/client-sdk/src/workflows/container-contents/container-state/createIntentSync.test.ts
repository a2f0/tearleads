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
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import {
  type ContainerCreateIntentRecord,
  defaultContainerContentsPersistence,
} from "../containerPersistence";
import type { ContainerState } from "../remoteHydration";
import { createContainerContentsWorkflowRuntime } from "../runtime";
import { syncPendingContainerCreateIntents } from "./createIntentSync";
import type { ContainerCreateIntentSyncState } from "./types";

function containerState(input: {
  id: string;
  parentId: string | null;
  synced: boolean;
}): ContainerState {
  return {
    container: {
      effectiveAccessLevel: "admin",
      icon: null,
      id: input.id,
      metadataDocumentId: input.synced ? `metadata-${input.id}` : "",
      name: input.id,
      organizationId: "organization",
      parentId: input.parentId,
      systemSlot: null,
    },
    doc: {} as ContainerState["doc"],
    record: {
      accessEpoch: 1,
      accessStateHash: input.synced ? `access-${input.id}` : "",
      documentId: input.synced ? `metadata-${input.id}` : "",
      id: `record-${input.id}`,
      metadataUpdates: "",
      snapshotEndVersion: "",
    },
  };
}

test("container create sync propagates identity failures without recording a retry", async () => {
  const integrityError = new KeyingVerificationError(
    "equivocation",
    "trusted identity changed",
  );
  const execSql: ExecSql = async () => [];
  const intent: ContainerCreateIntentRecord = {
    containerId: "child",
    createdAt: "2026-07-15T00:00:00.000Z",
    id: "create-child",
    intentType: "container.create",
    lastError: null,
    parentContainerId: "parent",
    remoteContainerId: null,
    remoteMetadataAccessStateHash: null,
    remoteMetadataDocumentId: null,
    syncStatus: "pending",
    updatedAt: "2026-07-15T00:00:00.000Z",
  };
  const recordedErrors: string[] = [];
  let projectionRequests = 0;
  const persistence: ContainerCreateIntentSyncState["persistence"] = {
    ...defaultContainerContentsPersistence,
    listPendingCreateIntents: async () => [intent],
    recordCreateIntentError: async (_execSql, _containerId, message) => {
      recordedErrors.push(message);
    },
  };
  const state: ContainerCreateIntentSyncState = {
    containersById: new Map([
      [
        "child",
        containerState({ id: "child", parentId: "parent", synced: false }),
      ],
      [
        "parent",
        containerState({ id: "parent", parentId: "root", synced: true }),
      ],
    ]),
    persistence,
    resolveProjectionUserKey: async () => null,
    runtime: {
      apiClient: {
        getContainerWriterProjection: async () => {
          projectionRequests += 1;
          throw integrityError;
        },
      } as unknown as ContainerCreateIntentSyncState["runtime"]["apiClient"],
      auth: {
        isAuthenticated: true,
        organizationId: "organization",
        userId: "user",
      },
      crypto: {
        encapsulationKeyPair: {
          secretKey: new Uint8Array(32),
        } as ContainerCreateIntentSyncState["runtime"]["crypto"]["encapsulationKeyPair"],
        signingFingerprint: "signing-fingerprint",
        signingKeyPair: {
          signingPrivateKey: new Uint8Array(32),
        } as ContainerCreateIntentSyncState["runtime"]["crypto"]["signingKeyPair"],
      },
      infra: {
        blobStore:
          {} as ContainerCreateIntentSyncState["runtime"]["infra"]["blobStore"],
        dbStatus: "ready",
        documentProjectors:
          {} as ContainerCreateIntentSyncState["runtime"]["infra"]["documentProjectors"],
        execSql,
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
      },
    },
  };

  await expect(
    syncPendingContainerCreateIntents({
      host: {
        persistContainerState: async () => {
          throw new Error("unexpected persist");
        },
      },
      isRemoteSyncBlocked: () => false,
      state,
    }),
  ).rejects.toBe(integrityError);
  expect(projectionRequests).toBe(1);
  expect(recordedErrors).toEqual([]);
});

test("container create sync defers a lost-response conflict and heals on hydration", async () => {
  const parent = await createParentProjection();
  const parentContainerId = parent.projection.containerId;
  const childContainerId = "child-with-lost-create-response";
  const { close, execSql } = await createTestExecSql(
    "container-create-intent-already-committed",
  );
  let submitCount = 0;
  let reported = false;
  const apiClient = createMockApiClient({
    // The create committed server-side but its response was lost; every
    // re-submit reports the manifest already exists.
    createContainerWithMetadataDocumentResult: async () => {
      submitCount += 1;
      return {
        kind: "http" as const,
        message:
          "POST /containers/with-metadata-document: 409 Conflict: Container manifest already exists",
        method: "POST" as const,
        ok: false as const,
        path: "/containers/with-metadata-document",
        report: () => {
          reported = true;
        },
        status: 409,
        statusText: "Conflict",
      };
    },
    getContainerWriterProjection: async (containerId: string) =>
      containerId === parentContainerId ? parent.projection : null,
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
    },
  });

  const childState = containerState({
    id: childContainerId,
    parentId: parentContainerId,
    synced: false,
  });
  const parentState = containerState({
    id: parentContainerId,
    parentId: "root",
    synced: true,
  });
  parentState.container.organizationId = parent.projection.organizationId;

  const intent: ContainerCreateIntentRecord = {
    containerId: childContainerId,
    createdAt: "2026-07-15T00:00:00.000Z",
    id: "create-child",
    intentType: "container.create",
    lastError: null,
    parentContainerId,
    remoteContainerId: null,
    remoteMetadataAccessStateHash: null,
    remoteMetadataDocumentId: null,
    syncStatus: "pending",
    updatedAt: "2026-07-15T00:00:00.000Z",
  };
  const recordedErrors: string[] = [];
  const syncedIntents: string[] = [];
  const persistence: ContainerCreateIntentSyncState["persistence"] = {
    ...defaultContainerContentsPersistence,
    listPendingCreateIntents: async () => [intent],
    recordCreateIntentError: async (_execSql, _containerId, message) => {
      recordedErrors.push(message);
    },
    markCreateIntentSynced: async (_execSql, input) => {
      syncedIntents.push(input.containerId);
    },
  };
  const state: ContainerCreateIntentSyncState = {
    containersById: new Map([
      [childContainerId, childState],
      [parentContainerId, parentState],
    ]),
    persistence,
    resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
    runtime,
  };
  const host = {
    persistContainerState: async () => {
      throw new Error("unexpected persist for an already-committed container");
    },
  };

  try {
    // First pass: the re-submit hits the benign manifest-exists conflict. The
    // intent must be deferred quietly — no error recorded, no report(), nothing
    // marked synced yet — matching the "no errors anywhere" the user observed.
    const firstCreated = await syncPendingContainerCreateIntents({
      host,
      isRemoteSyncBlocked: () => false,
      state,
    });
    expect(firstCreated).toBe(0);
    expect(submitCount).toBe(1);
    expect(reported).toBe(false);
    expect(recordedErrors).toEqual([]);
    expect(syncedIntents).toEqual([]);

    // Hydration discovers the committed container and populates its remote
    // metadata state; the next pass marks the pending intent synced.
    childState.record.documentId = `metadata-${childContainerId}`;
    childState.record.accessStateHash = `access-${childContainerId}`;

    const secondCreated = await syncPendingContainerCreateIntents({
      host,
      isRemoteSyncBlocked: () => false,
      state,
    });
    expect(secondCreated).toBe(1);
    expect(syncedIntents).toEqual([childContainerId]);
    // No further submit and still no surfaced error across the whole recovery.
    expect(submitCount).toBe(1);
    expect(reported).toBe(false);
    expect(recordedErrors).toEqual([]);
  } finally {
    close();
  }
});
