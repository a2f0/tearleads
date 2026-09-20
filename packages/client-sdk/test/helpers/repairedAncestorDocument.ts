import { createMockApiClient } from "@tearleads/test-utils";
import { buildMaterializedContainerRekeyPlan } from "../../src/workflows/containers/child/rekey";
import { buildRemoteDocumentSyncPlan } from "../../src/workflows/documents/syncContainerRekeys";
import { writerKeyResolver } from "./documentFixtures";
import { createPendingUpdateRecord } from "./documentResponseFixtures";
import { documentWithStaleAncestors } from "./staleAncestorDocument";
import { createFullHistoryRotationSnapshot } from "./staleBundleSyncFixture";

export async function repairedAncestorDocument() {
  const context = await documentWithStaleAncestors();
  const { fixture, input, projection } = context;
  try {
    const child = await buildMaterializedContainerRekeyPlan({
      ...input,
      previousProjection: {
        ...fixture.projection,
        containerId: fixture.child.projection.containerId,
        path: fixture.projection.path.slice(0, 2),
        containerKeks: fixture.projection.containerKeks.slice(0, 2),
      },
    });
    const leaf = await buildMaterializedContainerRekeyPlan({
      ...input,
      previousProjection: {
        ...fixture.projection,
        path: [
          ...child.writerProjection.path,
          ...fixture.projection.path.slice(2),
        ],
        containerKeks: [
          ...child.writerProjection.containerKeks,
          ...fixture.projection.containerKeks.slice(2),
        ],
      },
    });
    const healed = await buildRemoteDocumentSyncPlan({
      pendingUpdates: [createPendingUpdateRecord()],
      projection,
      regenerateQueuedCheckpoints: false,
      sync: {
        ...input,
        apiClient: createMockApiClient(),
        buildContainerRekeys: async () => [child, leaf],
        buildRotationSnapshot: createFullHistoryRotationSnapshot,
        documentId: projection.documentId,
        localVersionVector: null,
        resolveWriterPublicKey: writerKeyResolver(fixture.root),
        validateIncomingUpdates: () => undefined,
      },
    });
    return { ...context, repairedProjection: healed.writerProjection };
  } catch (error) {
    context.database.close();
    throw error;
  }
}
