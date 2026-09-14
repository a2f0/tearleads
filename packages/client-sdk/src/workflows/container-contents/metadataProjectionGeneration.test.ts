import { expect, test } from "bun:test";
import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import { createContainerMetadataDocument } from "../../data/containers/containerMetadataDocument";
import { invalidateContainerProjections } from "./container-state/projectionCache";
import { syncContainerMetadataState } from "./metadata";
import {
  createContainerContentsPersistence,
  createContainerRecord,
  createDocumentRecord,
} from "./metadata.testFixtures";
import {
  createDetachedContainerMetadataState,
  installDetachedContainerMetadataState,
} from "./metadataStateIsolation";
import type { ContainerState } from "./remoteHydration";

const METADATA_DOCUMENT_ID = "metadata-document-1";

function projectionFor(
  documentId: string,
  manifestHash: string,
): DocumentWriterProjectionResponse {
  return {
    documentId,
    manifestHash,
  } as unknown as DocumentWriterProjectionResponse;
}

async function liveContainerState(): Promise<ContainerState> {
  const container = createContainerRecord({
    id: "container-1",
    metadataDocumentId: METADATA_DOCUMENT_ID,
    parentId: null,
  });
  return {
    container,
    doc: await createContainerMetadataDocument(container.id),
    metadataWriterProjection: projectionFor(METADATA_DOCUMENT_ID, "before"),
    record: createDocumentRecord({
      documentId: METADATA_DOCUMENT_ID,
      id: container.id,
    }),
  };
}

test("a detached settlement that straddles a hint does not restore its metadata projection", async () => {
  const live = await liveContainerState();
  const candidate = await createDetachedContainerMetadataState(live);
  // A peer's grant hint lands while the candidate is out for settlement.
  invalidateContainerProjections(live);
  expect(live.metadataWriterProjection).toBeNull();

  installDetachedContainerMetadataState(live, candidate);
  expect(live.metadataWriterProjection).toBeNull();
});

test("an undisturbed detached settlement installs its metadata projection", async () => {
  const live = await liveContainerState();
  const candidate = await createDetachedContainerMetadataState(live);
  candidate.metadataWriterProjection = projectionFor(
    METADATA_DOCUMENT_ID,
    "settled",
  );
  installDetachedContainerMetadataState(live, candidate);
  expect(live.metadataWriterProjection).toBe(
    candidate.metadataWriterProjection,
  );
});

test("a metadata sync held open across a hint leaves the live projection dropped", async () => {
  const live = await liveContainerState();
  live.record = {
    ...live.record,
    contentKeyBundle: "content-key-bundle",
    documentKekTargets: "document-kek-targets",
    documentManifestBundle: "document-manifest-bundle",
  };
  let hintsDelivered = 0;
  const synced = await syncContainerMetadataState({
    isCurrent: () => true,
    metadataState: live,
    persistence: {
      ...createContainerContentsPersistence({}),
      async rekeyPendingUpdate() {
        return null;
      },
      async listPendingUpdates() {
        // The sync has detached its candidate and is about to go remote; the
        // hint for this container arrives now.
        invalidateContainerProjections(live);
        hintsDelivered += 1;
        return [];
      },
    },
    resolveProjectionUserKey: async () => {
      throw new Error("resolveProjectionUserKey should not be called.");
    },
    runtime: {
      apiClient: {
        getDocumentWriterProjection: async () => {
          throw new Error("metadata writer projection should not be loaded.");
        },
      },
      auth: { deviceId: "device-1", organizationId: "org-1", userId: "user-1" },
      crypto: {
        encapsulationKeyPair: null,
        signingKeyPair: null,
        signingFingerprint: null,
      },
      infra: { execSql: async () => [] },
      state: { containerId: null, domainScope: {}, events: [], online: true },
      util: { log: () => undefined },
    } as never,
    targetSecretKey: new Uint8Array(),
  });
  expect(hintsDelivered).toBe(1);
  expect(synced).toBeNull();
  // Whatever the pass concluded, it may not put the pre-hint copy back.
  expect(live.metadataWriterProjection).toBeNull();
});
