import { bytesToBase64 } from "@tearleads/encoding";
import {
  type createDocument,
  encodeVersionVector,
  exportFullHistorySnapshot,
  getTextValue,
  listVersionVectorSpans,
} from "@tearleads/loro";
import type {
  ContainerWriterProjectionResponse,
  DocumentSyncResponse,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import { sqlDocumentsPersistence } from "../../src/data/persistence/documents/documentsPersistence";
import type { ExecSql } from "../../src/data/sqlite/sqlSchema";
import { loadDocumentInfo } from "../../src/workflows/container-contents/documentInfo";

function documentInfoProjection(input: {
  document: DocumentSyncResponse;
  projection: ContainerWriterProjectionResponse;
}): DocumentWriterProjectionResponse {
  const manifestHash = input.document.contentKeyBundle.linkSetManifestHash;

  return {
    authorizingContainerPaths: [input.projection],
    contentKeyBundle: input.document.contentKeyBundle,
    documentContainerManifestHistory: input.projection.path,
    documentId: input.document.documentId,
    documentKekTargets: input.document.documentKekTargets,
    documentManifest: {
      event: {
        body: {},
        event: {},
        eventHash: `event:${manifestHash}`,
      },
      manifest: { epoch: 1, referencedPrincipalHeads: [] },
      manifestHash,
      state: { previousManifestHash: null },
    },
    documentManifestContainerPaths: [input.projection.path],
    documentManifestHistory: [],
  };
}

export async function loadColdRecoveredDocumentInfo(input: {
  authorFingerprint: string;
  document: DocumentSyncResponse;
  execSql: ExecSql;
  projection: ContainerWriterProjectionResponse;
  recovered: Awaited<ReturnType<typeof createDocument>>;
  userId: string;
}) {
  const writerProjection = documentInfoProjection(input);
  const attributionSegments = input.document.updates.flatMap((update) =>
    listVersionVectorSpans(update).map((span) => ({
      ...span,
      authorityKind: "direct" as const,
      writerKeyFingerprint: input.authorFingerprint,
      writerUserId: input.userId,
    })),
  );
  await sqlDocumentsPersistence.ensureSchema(input.execSql);
  await sqlDocumentsPersistence.saveDocument(
    input.execSql,
    {
      accessEpoch: 1,
      accessStateHash: "cold-access-state",
      containerId: input.projection.containerId,
      contentKeyBundle: JSON.stringify(input.document.contentKeyBundle),
      documentId: input.document.documentId,
      documentKekTargets: JSON.stringify(input.document.documentKekTargets),
      documentKind: "note",
      documentManifestBundle: JSON.stringify({
        manifestHash: input.document.contentKeyBundle.linkSetManifestHash,
      }),
      id: input.document.documentId,
      lastCommitLsn: input.document.commitLsn,
      snapshotEndVersion: encodeVersionVector(input.recovered),
      text: getTextValue(input.recovered),
      title: "Recovered",
    },
    { updatedAt: "2026-08-12T12:02:00.000Z" },
  );
  await sqlDocumentsPersistence.replaceHistoryCheckpoint(input.execSql, {
    coveredTailIds: [],
    endVersionVector: encodeVersionVector(input.recovered),
    force: true,
    localId: input.document.documentId,
    snapshot: bytesToBase64(exportFullHistorySnapshot(input.recovered)),
  });
  let attributionGetCount = 0;
  const info = await loadDocumentInfo({
    apiClient: {
      getDocumentEditAttribution: async (documentId) => {
        attributionGetCount += 1;
        if (documentId !== input.document.documentId) {
          throw new Error(`Unexpected attribution document ${documentId}`);
        }
        return {
          attributionRevision: 1,
          documentId,
          segments: attributionSegments,
        };
      },
      getDocumentWriterProjection: async () => writerProjection,
      listDocumentAttachments: async () => [],
    },
    execSql: input.execSql,
    localId: input.document.documentId,
    remoteInfoMode: "if-synced",
    reportSecurityIncident: async () => undefined,
  });

  return { attributionGetCount, info };
}
