import { type AccessEvent, computeAccessEventHash } from "@tearleads/crypto";
import type { DocumentPurgeProofResponse } from "@tearleads/validators/response";
import { buildDocumentPurgeRequest } from "../../src/workflows/documents/purge";
import type { createMaterializedSyncFixture } from "./documentFixtures";

type MaterializedSyncFixture = Awaited<
  ReturnType<typeof createMaterializedSyncFixture>
>;

export async function createDocumentPurgeProof(
  author: MaterializedSyncFixture["author"],
  writerProjection: MaterializedSyncFixture["writerProjection"],
): Promise<DocumentPurgeProofResponse> {
  const request = await buildDocumentPurgeRequest({
    author,
    writerProjection,
  });
  const event = request.event as unknown as AccessEvent;
  const authorizingPath = writerProjection.authorizingContainerPaths[0]?.path;
  if (!authorizingPath) throw new Error("Expected authorizing path");

  return {
    authorizingContainerPath: authorizingPath,
    documentContainerManifestHistory:
      writerProjection.documentContainerManifestHistory,
    documentId: writerProjection.documentId,
    documentManifest: writerProjection.documentManifest,
    documentManifestContainerPaths:
      writerProjection.documentManifestContainerPaths,
    documentManifestPredecessors: [],
    purgeEvent: {
      body: request.body,
      event: request.event,
      eventHash: await computeAccessEventHash(event),
    },
    purgedAt: "2026-08-26T12:00:00.000Z",
    principalPolicySnapshots: [],
  };
}
