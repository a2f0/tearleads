import { bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument,
  exportAllUpdates,
  getTextValue,
  getUpdateVersionVectors,
  importUpdates,
} from "@tearleads/loro";
import { createMockApiClient } from "@tearleads/test-utils";
import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import { buildDocumentSyncPlan } from "../../src/workflows/documents/syncPlan/syncPlanIdentity";
import { buildMaterializedDocumentSyncPlan } from "../../src/workflows/documents/syncPlan/syncPlanMaterial";
import {
  createMaterializedSyncFixture,
  createPendingUpdateRecord,
  createSyncResponse,
} from "./documentFixtures";

export async function createLoroPendingUpdate(text: string, id?: string) {
  const doc = await createDocument(`sync-fixture:${text}`);
  doc.getText("text").update(text);
  doc.commit();
  const update = exportAllUpdates(doc);
  const vectors = getUpdateVersionVectors(update);
  return createPendingUpdateRecord({
    ...(id === undefined ? {} : { id }),
    updateData: bytesToBase64(update),
    ...vectors,
  });
}

export async function decryptedUpdateText(
  update: Uint8Array | null | undefined,
): Promise<string> {
  if (!update) {
    throw new Error("Expected a decrypted Loro update");
  }
  const reader = await createDocument("sync-test-reader");
  importUpdates(reader, [update]);
  return getTextValue(reader);
}

export function persistedStateFromProjection(
  projection: DocumentWriterProjectionResponse,
) {
  return {
    contentKeyBundle: JSON.stringify(projection.contentKeyBundle),
    documentId: projection.documentId,
    documentKekTargets: JSON.stringify(projection.documentKekTargets),
    documentManifestBundle: JSON.stringify(projection.documentManifest),
  };
}

export async function createReadOnlyResponseFixture() {
  const fixture = await createMaterializedSyncFixture();
  const materialized = await buildMaterializedDocumentSyncPlan({
    author: fixture.author,
    localVersionVector: null,
    pendingUpdates: [createPendingUpdateRecord()],
    targetSecretKey: fixture.secretKey,
    trustedLocalProjection: true,
    writerProjection: fixture.writerProjection,
  });
  const response = await createSyncResponse(materialized.plan);
  const update = response.updates[0];
  if (!update) {
    throw new Error("Expected persisted read-only update fixture");
  }

  return { ...fixture, update };
}

export function readOnlySyncApi(input: {
  corruptUpdate?: boolean | undefined;
  fixture: Awaited<ReturnType<typeof createReadOnlyResponseFixture>>;
  onProjectionEviction?: ((documentId: string) => void) | undefined;
  onProjectionFetch: () => void;
  onSync?: (() => void) | undefined;
  projectionAfterEviction?: DocumentWriterProjectionResponse | null;
  zeroUpdateDocumentId?: string | undefined;
}) {
  let projectionEvicted = false;
  return createMockApiClient({
    evictDocumentWriterProjection: (documentId: string) => {
      projectionEvicted = true;
      input.onProjectionEviction?.(documentId);
    },
    getDocumentWriterProjection: async (documentId: string) => {
      input.onProjectionFetch();
      if (documentId !== input.fixture.writerProjection.documentId) return null;
      return projectionEvicted && input.projectionAfterEviction !== undefined
        ? input.projectionAfterEviction
        : input.fixture.writerProjection;
    },
    syncDocument: async (
      documentId: string,
      request: { localVersionVector: string | null },
    ) => {
      input.onSync?.();
      const plan = await buildDocumentSyncPlan({
        author: input.fixture.author,
        contentKeyBundle: input.fixture.writerProjection.contentKeyBundle,
        documentId,
        documentKekTargets: input.fixture.writerProjection.documentKekTargets,
        documentManifest: input.fixture.writerProjection.documentManifest,
        localVersionVector: request.localVersionVector,
      });
      return createSyncResponse(
        { ...plan, documentId, request: request as typeof plan.request },
        input.zeroUpdateDocumentId
          ? {
              documentId: input.zeroUpdateDocumentId,
              updates: [],
            }
          : {
              updates: [
                {
                  ...input.fixture.update,
                  ...(input.corruptUpdate
                    ? { encryptedData: "invalid-if-decryption-is-reached" }
                    : {}),
                },
              ],
            },
      );
    },
  });
}
