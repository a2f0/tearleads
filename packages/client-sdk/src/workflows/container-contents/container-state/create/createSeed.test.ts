import { expect, test } from "bun:test";
import type { ApiClient } from "@tearleads/api-client";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import type { ContainerCreateWithMetadataDocumentRequest } from "@tearleads/validators/request";
import { CONTAINER_MUTATION_ERROR_CODES } from "@tearleads/validators/response";
import {
  createMutationResponseFromRequest,
  createParentProjection,
  createParentProjectionUserKeyResolver,
} from "../../../../../test/helpers/containerFixtures";
import { createResponseFromRequest } from "../../../../../test/helpers/documentFixtures";
import { createMemoryBlobStore } from "../../../../data/blobs/memoryBlobStore";
import { createInitializedContainerMetadataDocument } from "../../../../data/containers/containerMetadataDocument";
import { defaultDocumentProjectorRegistry } from "../../../../data/documents/documentKinds";
import { createPendingUpdateFields } from "../../../../data/documents/documentSync";
import { createDomainScope } from "../../../../data/shared/domainScope";
import type { PendingUpdateRecord } from "../../../../data/sqlite/documentPersistence";
import type { ExecSql } from "../../../../data/sqlite/sqlSchema";
import {
  type ContainerCreateIntentRecord,
  defaultContainerContentsPersistence,
} from "../../containerPersistence";
import { listContainerMetadataDocumentUpdateIds } from "../../metadata/metadataEvents";
import { createContainerContentsWorkflowRuntime } from "../../runtime";
import { createTestContainerState } from "../containerState.testFixtures";
import type { ContainerCreateIntentSyncState } from "../types";
import { syncPendingContainerCreateIntents } from "./createIntentSync";
import {
  CONTAINER_ALREADY_COMMITTED,
  createRemoteContainerWithMetadataDocument,
} from "./createWithMetadata";

type CreateResult = Awaited<
  ReturnType<ApiClient["createContainerWithMetadataDocumentResult"]>
>;

function failure(status: number, code?: string): CreateResult {
  return {
    ...(code === undefined ? {} : { code }),
    kind: "http",
    message: `POST /containers/with-metadata-document: ${status}`,
    method: "POST",
    ok: false,
    path: "/containers/with-metadata-document",
    report: () => undefined,
    status,
    statusText: "Refused",
  };
}

async function acknowledge(
  request: ContainerCreateWithMetadataDocumentRequest,
): Promise<CreateResult> {
  const seedId = request.initialMetadataSync?.outgoingUpdates[0]?.id;
  return {
    data: {
      container: await createMutationResponseFromRequest(request.container),
      metadataDocument: {
        ...(await createResponseFromRequest(request.metadataDocument)),
        ...(seedId
          ? {
              initialSync: {
                acceptedOutgoingUpdateIds: [seedId],
                commitLsn: "0/20",
                commitLsnMode: "tracked" as const,
              },
            }
          : {}),
      },
    },
    ok: true,
  };
}

async function metadataSeed(containerId: string) {
  const metadata = await createInitializedContainerMetadataDocument(
    containerId,
    { icon: null, name: "Seeded folder" },
  );
  const fields = createPendingUpdateFields(metadata.initialUpdate);
  if (!fields) throw new Error("Expected a non-empty metadata update");
  const seed: PendingUpdateRecord = { id: crypto.randomUUID(), ...fields };
  return { doc: metadata.doc, seed };
}

async function createRuntime(input: {
  readonly execSql: ExecSql;
  readonly parent: Awaited<ReturnType<typeof createParentProjection>>;
  readonly requests: ContainerCreateWithMetadataDocumentRequest[];
  readonly respond: (
    request: ContainerCreateWithMetadataDocumentRequest,
    attempt: number,
  ) => Promise<CreateResult>;
}) {
  const { parent } = input;
  return createContainerContentsWorkflowRuntime({
    apiClient: createMockApiClient({
      createContainerWithMetadataDocumentResult: async (request) => {
        input.requests.push(request);
        return input.respond(request, input.requests.length);
      },
      getContainerWriterProjection: async (containerId: string) =>
        containerId === parent.projection.containerId
          ? parent.projection
          : null,
    }),
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
      execSql: input.execSql,
    },
    resolveTrustedUserIdentity: async () => null,
    state: {
      containerId: parent.projection.containerId,
      domainScope: createDomainScope(),
      events: [],
      online: true,
    },
    util: {
      log: () => undefined,
      reportSecurityIncident: async () => undefined,
    },
  });
}

async function runSeededContainerCreate(
  name: string,
  respond: (
    request: ContainerCreateWithMetadataDocumentRequest,
    attempt: number,
  ) => Promise<CreateResult>,
) {
  const parent = await createParentProjection();
  const containerId = crypto.randomUUID();
  const { seed } = await metadataSeed(containerId);
  const requests: ContainerCreateWithMetadataDocumentRequest[] = [];
  const { close, execSql } = await createTestExecSql(name);
  try {
    const created = await createRemoteContainerWithMetadataDocument({
      containerId,
      metadataSeedUpdate: seed,
      parentContainerId: parent.projection.containerId,
      parentProjection: parent.projection,
      resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
      runtime: await createRuntime({ execSql, parent, requests, respond }),
    });
    return { created, requests, seed };
  } finally {
    close();
  }
}

test("an acknowledged container create reports its committed metadata seed", async () => {
  const { created, requests, seed } = await runSeededContainerCreate(
    "container-seed-acknowledged",
    acknowledge,
  );
  if (!created || typeof created === "symbol") {
    throw new Error("Expected a fresh container create");
  }
  expect(requests).toHaveLength(1);
  expect(
    requests[0]?.initialMetadataSync?.outgoingUpdates.map(
      (update) => update.id,
    ),
  ).toEqual([seed.id]);
  expect(created.metadataSeed).toEqual({
    commitLsn: "0/20",
    updateId: seed.id,
  });
});

test("a refused seeded container create falls back to the plain create once", async () => {
  const { created, requests } = await runSeededContainerCreate(
    "container-seed-refused",
    (request, attempt) =>
      attempt === 1 ? Promise.resolve(failure(402)) : acknowledge(request),
  );
  if (!created || typeof created === "symbol") {
    throw new Error("Expected a fresh container create");
  }
  expect(
    requests.map((request) => Boolean(request.initialMetadataSync)),
  ).toEqual([true, false]);
  expect(created.metadataSeed).toBeUndefined();
});

test("a lost seeded container create response is adopted without resubmitting", async () => {
  const { created, requests } = await runSeededContainerCreate(
    "container-seed-lost-response",
    () =>
      Promise.resolve(
        failure(409, CONTAINER_MUTATION_ERROR_CODES.manifestAlreadyExists),
      ),
  );
  expect(created).toBe(CONTAINER_ALREADY_COMMITTED);
  expect(requests).toHaveLength(1);
});

/** Classifies one metadata update hint as the store's event handler does. */
type MetadataHint = (documentId: string, updateIds: string[]) => string[];

async function runReplayedSeededCreate(
  name: string,
  respond: (
    request: ContainerCreateWithMetadataDocumentRequest,
    attempt: number,
    hint: MetadataHint,
  ) => Promise<CreateResult>,
  tearDownOnSeedEncrypt = false,
) {
  const parent = await createParentProjection();
  const parentContainerId = parent.projection.containerId;
  const childContainerId = crypto.randomUUID();
  const { doc, seed } = await metadataSeed(childContainerId);
  const requests: ContainerCreateWithMetadataDocumentRequest[] = [];
  const { close, execSql } = await createTestExecSql(name);
  const locallyAcceptedMetadataUpdateIds = new Set<string>();
  const plannedMetadataDocumentIds = new Set<string>();
  const childState = createTestContainerState({
    id: childContainerId,
    parentId: parentContainerId,
    synced: false,
  });
  childState.doc = doc;
  const parentState = createTestContainerState({
    id: parentContainerId,
    parentId: "root",
    synced: true,
  });
  parentState.container.organizationId = parent.projection.organizationId;
  const intent: ContainerCreateIntentRecord = {
    containerId: childContainerId,
    createdAt: "2026-10-19T00:00:00.000Z",
    id: "create-seeded-child",
    intentType: "container.create",
    lastAttemptedAt: null,
    lastError: null,
    parentContainerId,
    remoteContainerId: null,
    remoteMetadataAccessStateHash: null,
    remoteMetadataDocumentId: null,
    syncStatus: "pending",
    updatedAt: "2026-10-19T00:00:00.000Z",
  };
  const persisted: unknown[] = [];
  let current = true;
  // The seed's payload is first read inside its encryption.
  const queuedSeed = tearDownOnSeedEncrypt
    ? Object.defineProperty({ ...seed }, "updateData", {
        enumerable: true,
        get: () => {
          current = false;
          return seed.updateData;
        },
      })
    : seed;
  const state: ContainerCreateIntentSyncState = {
    containersById: new Map([
      [childContainerId, childState],
      [parentContainerId, parentState],
    ]),
    persistence: {
      ...defaultContainerContentsPersistence,
      listPendingCreateIntents: async () => [intent],
      listPendingUpdates: async (_execSql, containerId) =>
        containerId === childContainerId ? [queuedSeed] : [],
      recordCreateIntentRevisionError: async () => undefined,
    },
    locallyAcceptedMetadataUpdateIds,
    plannedMetadataDocumentIds,
    resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
    runtime: await createRuntime({
      execSql,
      parent,
      requests,
      respond: (request, attempt) =>
        respond(request, attempt, (documentId, updateIds) =>
          listContainerMetadataDocumentUpdateIds(
            [
              {
                containerIds: [childContainerId],
                documentId,
                type: "document_update_created",
                updateIds,
              },
            ],
            state.containersById.values(),
            locallyAcceptedMetadataUpdateIds,
            plannedMetadataDocumentIds,
          ),
        ),
    }),
  };
  try {
    const created = await syncPendingContainerCreateIntents({
      host: {
        persistContainerState: async (
          _containerState,
          patch,
          _updateView,
          _saveOptions,
          mutationOptions,
        ) => {
          persisted.push({
            acceptedPendingUpdateIds: mutationOptions?.acceptedPendingUpdateIds,
            clearSyncFailure: mutationOptions?.clearSyncFailure,
            lastCommitLsn: patch?.lastCommitLsn,
          });
          return {
            createIntentSettled: true,
            record: childState.record,
            status: "persisted",
          };
        },
      },
      isCurrent: () => current,
      isRemoteSyncBlocked: () => false,
      requestRemoteReconciliation: () => undefined,
      state,
    });
    return {
      created,
      locallyAcceptedMetadataUpdateIds,
      persisted,
      plannedMetadataDocumentIds,
      requests,
      seed,
    };
  } finally {
    close();
  }
}

test("a replayed container create settles its queued metadata seed", async () => {
  const result = await runReplayedSeededCreate(
    "container-seed-replay",
    acknowledge,
  );
  expect(result.created).toBe(1);
  expect(
    result.requests[0]?.initialMetadataSync?.outgoingUpdates.map(
      (update) => update.id,
    ),
  ).toEqual([result.seed.id]);
  expect(result.persisted).toEqual([
    {
      acceptedPendingUpdateIds: [result.seed.id],
      clearSyncFailure: true,
      lastCommitLsn: "0/20",
    },
  ]);
  // Registered before the create, so its own update echo stays self-authored.
  expect([...result.locallyAcceptedMetadataUpdateIds]).toEqual([
    result.seed.id,
  ]);
});

test("a replayed container create whose seed was refused drops its registration", async () => {
  const result = await runReplayedSeededCreate(
    "container-seed-replay-refused",
    (request, attempt) =>
      attempt === 1 ? Promise.resolve(failure(402)) : acknowledge(request),
  );
  expect(result.created).toBe(1);
  expect(
    result.requests.map((request) => Boolean(request.initialMetadataSync)),
  ).toEqual([true, false]);
  expect(result.persisted).toEqual([
    {
      acceptedPendingUpdateIds: undefined,
      clearSyncFailure: undefined,
      lastCommitLsn: null,
    },
  ]);
  expect([...result.locallyAcceptedMetadataUpdateIds]).toEqual([]);
});

test("a peer's metadata hint before the create response still queues a read", async () => {
  const observed: { echo?: string[]; peer?: string[]; planned?: string } = {};
  const result = await runReplayedSeededCreate(
    "container-seed-delayed-response",
    (request, _attempt, hint) => {
      const documentId = String(
        Reflect.get(request.metadataDocument.manifest, "objectId"),
      );
      const seedId = request.initialMetadataSync?.outgoingUpdates[0]?.id ?? "";
      observed.planned = documentId;
      // The seed's own echo is self-authored and queues nothing.
      observed.echo = hint(documentId, [seedId]);
      // A peer renames the committed folder before the response arrives,
      // while the folder's record has no metadata document id yet.
      observed.peer = hint(documentId, ["peer-rename"]);
      return acknowledge(request);
    },
  );
  expect(result.created).toBe(1);
  expect(result.persisted).toEqual([
    {
      acceptedPendingUpdateIds: [result.seed.id],
      clearSyncFailure: true,
      lastCommitLsn: "0/20",
    },
  ]);
  expect(observed.echo).toEqual([]);
  expect(observed.planned).toBeDefined();
  expect(observed.peer).toEqual([observed.planned ?? ""]);
  expect([...result.plannedMetadataDocumentIds]).toEqual([]);
});

test("a container create torn down while its seed encrypts submits nothing", async () => {
  const result = await runReplayedSeededCreate(
    "container-seed-teardown",
    acknowledge,
    true,
  );
  expect(result.requests).toEqual([]);
  expect(result.persisted).toEqual([]);
});
