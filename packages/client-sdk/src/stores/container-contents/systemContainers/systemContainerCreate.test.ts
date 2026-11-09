import { expect, mock, test } from "bun:test";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import type { ContainerCreateWithMetadataDocumentRequest } from "@tearleads/validators/request";
import {
  createMutationResponseFromRequest,
  createParentProjection,
  createParentProjectionUserKeyResolver,
} from "../../../../test/helpers/containerFixtures";
import { createResponseFromRequest } from "../../../../test/helpers/documentFixtures";
import { createMemoryBlobStore } from "../../../data/blobs/memoryBlobStore";
import { defaultDocumentProjectorRegistry } from "../../../data/documents/documentKinds";
import { createDomainScope } from "../../../data/shared/domainScope";
import { createTestContainerState } from "../../../workflows/container-contents/container-state/containerState.testFixtures";
import { defaultContainerContentsPersistence } from "../../../workflows/container-contents/containerPersistence";
import { handleContainerContentsRemoteEvents } from "../remoteEvents/remoteEventSync";
import { createContainerContentsStoreTestRuntime } from "../runtime.testFixtures";
import { createContainerContentsStoreState } from "../state";
import type { ContainerContentsStoreSyncAgent } from "../syncAgent";
import { createSystemContainer } from "./systemContainerCreate";

const SLOT = `sys_v1_${"c".repeat(43)}`;

test("a peer's metadata hint during an eager system create queues its read", async () => {
  const parent = await createParentProjection();
  const { close, execSql } = await createTestExecSql(
    "eager-system-create-delayed-response",
  );
  try {
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    const runtime = createContainerContentsStoreTestRuntime({
      apiClient: createMockApiClient({
        createContainerWithMetadataDocumentResult: async (request) => {
          // A peer renames the committed slot before this response arrives,
          // while no local record names its metadata document yet.
          deliverPeerRename(request);
          return { data: await acknowledge(request), ok: true };
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
        execSql,
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
    const state = createContainerContentsStoreState(
      runtime,
      defaultContainerContentsPersistence,
    );
    state.initialized = true;
    state.resolveProjectionUserKey =
      createParentProjectionUserKeyResolver(parent);
    const rootState = createTestContainerState({
      id: parent.projection.containerId,
      organizationId: parent.projection.organizationId,
      parentId: null,
    });
    state.containersById.set(rootState.container.id, rootState);
    const hintSchedules = mock(() => {});
    const scheduleSync = mock(() => {});
    const deliverPeerRename = (
      request: ContainerCreateWithMetadataDocumentRequest,
    ) => {
      const documentId = String(
        Reflect.get(request.metadataDocument.manifest, "objectId"),
      );
      state.runtime = {
        ...state.runtime,
        state: {
          ...state.runtime.state,
          events: [
            {
              containerIds: [documentId],
              documentId,
              type: "document_update_created",
              updateIds: ["peer-rename"],
            },
          ],
        },
      };
      handleContainerContentsRemoteEvents({
        requestHydration: async () => {},
        scheduleSync: hintSchedules,
        state,
      });
    };

    const finalized = await createSystemContainer({
      createRemote: true,
      isCurrent: () => true,
      options: {},
      rootState,
      state,
      syncAgent: {
        scheduleRemoteHydration: () => undefined,
        scheduleSync,
      } as unknown as ContainerContentsStoreSyncAgent,
      systemSlot: SLOT,
      trimmedName: "Contacts",
    });

    const metadataDocumentId = finalized?.containerState.record.documentId;
    expect(metadataDocumentId).toBeString();
    // The seed committed, so only the peer's queued read asks for a pass, and
    // it asks after the created record is installed for that pass to sync.
    expect(finalized?.containerState.record.lastCommitLsn).toBe("0/20");
    expect(state.metadataDocumentIdsNeedingSync).toEqual(
      new Set([metadataDocumentId ?? ""]),
    );
    expect(hintSchedules).toHaveBeenCalledTimes(1);
    expect(scheduleSync).toHaveBeenCalledTimes(1);
    expect(state.plannedMetadataDocumentIds.size).toBe(0);
  } finally {
    close();
  }
});

async function acknowledge(
  request: ContainerCreateWithMetadataDocumentRequest,
) {
  const seedId = request.initialMetadataSync?.outgoingUpdates[0]?.id;
  if (!seedId) throw new Error("Expected the eager create to carry its seed");
  return {
    container: await createMutationResponseFromRequest(request.container),
    metadataDocument: {
      ...(await createResponseFromRequest(request.metadataDocument)),
      initialSync: {
        acceptedOutgoingUpdateIds: [seedId],
        commitLsn: "0/20",
        commitLsnMode: "tracked" as const,
      },
    },
  };
}
