/** Seeded container create harnesses shared by the create tests. */
import type { ApiClient } from "@tearleads/api-client";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import type { ContainerCreateWithMetadataDocumentRequest } from "@tearleads/validators/request";
import { createMemoryBlobStore } from "../../../src/data/blobs/memoryBlobStore";
import { defaultDocumentProjectorRegistry } from "../../../src/data/documents/documentKinds";
import { createPendingUpdateFields } from "../../../src/data/documents/documentSync";
import type { PendingUpdateRecord } from "../../../src/data/persistence/documents/records";
import { createDomainScope } from "../../../src/data/shared/domainScope";
import type { ExecSql } from "../../../src/data/sqlite/sqlSchema";
import { createTestContainerState } from "../../../src/workflows/container-contents/container-state/containerState.testFixtures";
import { syncPendingContainerCreateIntents } from "../../../src/workflows/container-contents/container-state/create/createIntentSync";
import { createRemoteContainerWithMetadataDocument } from "../../../src/workflows/container-contents/container-state/create/createWithMetadata";
import type { ContainerCreateIntentSyncState } from "../../../src/workflows/container-contents/container-state/types";
import {
  type ContainerCreateIntentRecord,
  defaultContainerContentsPersistence,
} from "../../../src/workflows/container-contents/containerPersistence";
import { createInitializedContainerMetadataDocument } from "../../../src/workflows/container-contents/metadata/containerMetadataDocument";
import { listContainerMetadataDocumentUpdateIds } from "../../../src/workflows/container-contents/metadata/metadataEvents";
import {
  createMutationResponseFromRequest,
  createParentProjection,
  createParentProjectionUserKeyResolver,
} from "../data/containerFixtures";
import { createResponseFromRequest } from "../data/documentFixtures";
import { createContainerContentsWorkflowRuntime } from "./containerContentsWorkflowRuntime";

export type CreateResult = Awaited<
  ReturnType<ApiClient["createContainerWithMetadataDocumentResult"]>
>;

export function failure(status: number, code?: string): CreateResult {
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

export async function acknowledge(
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

export async function runSeededContainerCreate(
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

function requestContainerId(
  request: ContainerCreateWithMetadataDocumentRequest,
): unknown {
  return Reflect.get(request.container.event, "objectId");
}

async function siblingCreate(parentContainerId: string) {
  const id = crypto.randomUUID();
  const state = createTestContainerState({
    id,
    parentId: parentContainerId,
    synced: false,
  });
  state.doc = (await metadataSeed(id)).doc;
  const intent: ContainerCreateIntentRecord = {
    containerId: id,
    createdAt: "2026-10-19T00:00:01.000Z",
    id: "create-sibling",
    intentType: "container.create",
    lastAttemptedAt: null,
    lastError: null,
    parentContainerId,
    remoteContainerId: null,
    remoteMetadataAccessStateHash: null,
    remoteMetadataDocumentId: null,
    syncStatus: "pending",
    updatedAt: "2026-10-19T00:00:01.000Z",
  };
  return { intent, state };
}

/** Classifies one metadata update hint as the store's event handler does. */
export type MetadataHint = (
  documentId: string,
  updateIds: string[],
) => string[];

export async function runReplayedSeededCreate(
  name: string,
  respond: (
    request: ContainerCreateWithMetadataDocumentRequest,
    attempt: number,
    hint: MetadataHint,
  ) => Promise<CreateResult>,
  tearDownOnSeedEncrypt = false,
  isRemoteSyncBlocked: (organizationId: string) => boolean = () => false,
  /** Queues an ordinary create after it, which the server acknowledges. */
  acknowledgedSibling = false,
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
  const sibling = acknowledgedSibling
    ? await siblingCreate(parentContainerId)
    : null;
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
  const reconciliationRequests: Array<string | null> = [];
  const recordedErrors: string[] = [];
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
      ...(sibling
        ? [[sibling.state.container.id, sibling.state] as const]
        : []),
    ]),
    persistence: {
      ...defaultContainerContentsPersistence,
      listPendingCreateIntents: async () =>
        sibling ? [intent, sibling.intent] : [intent],
      listPendingUpdates: async (_execSql, containerId) =>
        containerId === childContainerId ? [queuedSeed] : [],
      recordCreateIntentRevisionError: async (_execSql, error) => {
        recordedErrors.push(error.message);
      },
    },
    locallyAcceptedMetadataUpdateIds,
    plannedMetadataDocumentIds,
    resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
    runtime: await createRuntime({
      execSql,
      parent,
      requests,
      respond: (request, attempt) =>
        sibling && requestContainerId(request) === sibling.state.container.id
          ? acknowledge(request)
          : respond(request, attempt, (documentId, updateIds) =>
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
      isRemoteSyncBlocked,
      requestRemoteReconciliation: (parentContainerId) => {
        reconciliationRequests.push(parentContainerId);
      },
      state,
    });
    return {
      created,
      locallyAcceptedMetadataUpdateIds,
      organizationId: parent.projection.organizationId,
      persisted,
      plannedMetadataDocumentIds,
      reconciliationRequests,
      recordedErrors,
      requests,
      /** The child's own requests, without its sibling's. */
      childRequests: requests.filter(
        (request) => requestContainerId(request) === childContainerId,
      ),
      seed,
    };
  } finally {
    close();
  }
}
