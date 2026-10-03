import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import { createMemoryBlobStore } from "../../src/data/blobs/memoryBlobStore";
import { defaultDocumentProjectorRegistry } from "../../src/data/documents/documentKinds";
import { createDomainScope } from "../../src/data/domainScope";
import { createTestContainerState } from "../../src/workflows/container-contents/container-state/containerState.testFixtures";
import { syncPendingContainerCreateIntents } from "../../src/workflows/container-contents/container-state/createIntentSync";
import type { ContainerCreateIntentSyncState } from "../../src/workflows/container-contents/container-state/types";
import {
  type ContainerCreateIntentRecord,
  defaultContainerContentsPersistence,
} from "../../src/workflows/container-contents/containerPersistence";
import { createContainerContentsWorkflowRuntime } from "../../src/workflows/container-contents/runtime";
import {
  createParentProjection,
  createParentProjectionUserKeyResolver,
} from "./containerFixtures";
import {
  createChildContainerProjection,
  moveContainerProjection,
} from "./projectionHierarchy";

type Parent = Awaited<ReturnType<typeof createParentProjection>>;

/** A parent folder and the signed child creates a listing can carry. */
export async function createAdoptionScenario() {
  const parent = await createParentProjection();
  const listedChild = async (parentProjection = parent.projection) =>
    (
      await createChildContainerProjection({
        containerId: crypto.randomUUID(),
        parent,
        parentProjection,
      })
    ).projection;
  /** The child as another writer left it after moving it under `destination`. */
  const movedChild = async (
    child: ContainerWriterProjectionResponse,
    destination: ContainerWriterProjectionResponse,
  ) => {
    const created = child.path.at(-1);
    if (!created) throw new Error("Expected the child's create");
    return (
      await moveContainerProjection({
        containerId: child.containerId,
        destinationParentProjection: destination,
        eventId: `move-${child.containerId}`,
        manifestHistory: [created],
        parent,
        sourceProjection: child,
      })
    ).projection;
  };
  return { listedChild, movedChild, parent };
}

export interface ListedIntent {
  /** The listed container this intent's create is pending for. */
  readonly containerId: string;
  /** Where the user wants it; defaults to the scenario's parent. */
  readonly desiredParentId?: string;
  readonly lastError?: string;
  /** The organization the intended parent belongs to locally. */
  readonly organization?: "same" | "other";
  /** No listing carries it yet, so the pass would create it remotely. */
  readonly unlisted?: true;
}

function pendingIntent(
  listed: ListedIntent,
  parentId: string,
): ContainerCreateIntentRecord {
  return {
    containerId: listed.containerId,
    createdAt: "2026-09-30T00:00:00.000Z",
    id: `create-${listed.containerId}`,
    intentType: "container.create",
    lastAttemptedAt: null,
    lastError: listed.lastError ?? null,
    parentContainerId: parentId,
    remoteContainerId: null,
    remoteMetadataAccessStateHash: null,
    remoteMetadataDocumentId: null,
    syncStatus: "pending",
    updatedAt: "2026-09-30T00:00:00.000Z",
  };
}

function runtimeFor(input: {
  readonly evicted: string[];
  readonly execSql: Awaited<ReturnType<typeof createTestExecSql>>["execSql"];
  readonly incidents: string[];
  readonly parent: Parent;
  readonly reads: string[];
  readonly served: readonly ContainerWriterProjectionResponse[];
  readonly sessionUser: "another" | "creator" | "none";
}) {
  const { parent } = input;
  return createContainerContentsWorkflowRuntime({
    apiClient: createMockApiClient({
      evictContainerWriterProjection: (containerId: string) => {
        input.evicted.push(containerId);
      },
      getContainerWriterProjection: async (containerId: string) => {
        input.reads.push(containerId);
        return (
          input.served.find((listed) => listed.containerId === containerId) ??
          null
        );
      },
    }),
    auth: {
      isAuthenticated: true,
      organizationId: parent.projection.organizationId,
      userId: {
        another: "another-user",
        creator: parent.userId,
        none: null,
      }[input.sessionUser],
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
      reportSecurityIncident: async (_error, context) => {
        input.incidents.push(context.operation);
      },
    },
  });
}

/** Local state after hydration installed each listed container's metadata. */
function localContainers(parent: Parent, intents: readonly ListedIntent[]) {
  const containers = new Map<
    string,
    ReturnType<typeof createTestContainerState>
  >();
  for (const listed of intents) {
    const parentId = listed.desiredParentId ?? parent.projection.containerId;
    const child = createTestContainerState({
      id: listed.containerId,
      parentId,
      synced: listed.unlisted !== true,
    });
    containers.set(listed.containerId, child);
    // A parent that is itself a listed intent keeps its own state.
    if (containers.has(parentId)) continue;
    const parentState = createTestContainerState({
      id: parentId,
      organizationId:
        listed.organization === "other"
          ? "another-organization"
          : parent.projection.organizationId,
      parentId: "root",
      synced: true,
    });
    containers.set(parentId, parentState);
  }
  return containers;
}

/**
 * One create-intent pass over listed containers whose remote metadata
 * hydration already installed. Settlement is recorded rather than persisted.
 */
export async function runListedCreateAdoption(input: {
  readonly blocked?: boolean;
  readonly intents: readonly ListedIntent[];
  readonly parent: Parent;
  readonly served: readonly ContainerWriterProjectionResponse[];
  readonly sessionUser?: "another" | "creator" | "none";
}) {
  const { parent } = input;
  const { close, execSql } = await createTestExecSql(
    `container-create-adoption-${crypto.randomUUID()}`,
  );
  const evicted: string[] = [];
  const incidents: string[] = [];
  const reconciled: Array<string | null> = [];
  const reads: string[] = [];
  const recordedErrors: string[] = [];
  const settlements: Array<{
    readonly containerId: string;
    readonly createdParent: string | undefined;
    readonly currentParent: string | undefined;
    readonly desiredParent: string | undefined;
  }> = [];
  const intents = input.intents.map((listed) =>
    pendingIntent(
      listed,
      listed.desiredParentId ?? parent.projection.containerId,
    ),
  );
  const state: ContainerCreateIntentSyncState = {
    containersById: localContainers(parent, input.intents),
    persistence: {
      ...defaultContainerContentsPersistence,
      listPendingCreateIntents: async () => intents,
      recordCreateIntentRevisionError: async (_execSql, error) => {
        recordedErrors.push(error.message);
      },
      markCreateIntentRevisionSynced: async (_execSql, synced) => {
        settlements.push({
          containerId: synced.containerId,
          createdParent: synced.createdParentContainerId,
          currentParent: synced.supersededMovePreviousParentId,
          desiredParent: synced.desiredParentContainerId,
        });
        return true;
      },
    },
    resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
    runtime: runtimeFor({
      evicted,
      execSql,
      incidents,
      parent,
      reads,
      served: input.served,
      sessionUser: input.sessionUser ?? "creator",
    }),
  };
  try {
    const created = await syncPendingContainerCreateIntents({
      host: {
        persistContainerState: async () => {
          throw new Error("an adopted container is never re-created");
        },
      },
      isCurrent: () => true,
      isRemoteSyncBlocked: () => input.blocked === true,
      requestRemoteReconciliation: (parentId) => {
        reconciled.push(parentId);
      },
      state,
    });
    return {
      created,
      evicted,
      incidents,
      reads,
      reconciled,
      recordedErrors,
      settlements,
    };
  } finally {
    close();
  }
}
