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
  DocumentContentKeyBundleResponse,
  DocumentKekTargetsResponse,
  DocumentSyncResponse,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import { sqlDocumentsPersistence } from "../../src/data/persistence/documents/documentsPersistence";
import type { ExecSql } from "../../src/data/sqlite/sqlSchema";
import { loadDocumentInfo } from "../../src/workflows/container-contents/info/documentInfo";

/** A synced document: the server response plus the bundle and targets it synced against. */
type ColdSyncedDocument = {
  contentKeyBundle: DocumentContentKeyBundleResponse;
  documentKekTargets: DocumentKekTargetsResponse;
  response: DocumentSyncResponse;
};

function documentInfoProjection(input: {
  document: ColdSyncedDocument;
  projection: ContainerWriterProjectionResponse;
}): DocumentWriterProjectionResponse {
  const manifestHash = input.document.contentKeyBundle.linkSetManifestHash;

  return {
    policyEvidence: {
      organization: null,
      organizationPayloads: [],
      groups: [],
    },
    authorizingContainerPaths: [input.projection],
    contentKeyBundle: input.document.contentKeyBundle,
    documentContainerManifestHistory: input.projection.path,
    documentId: input.document.response.documentId,
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
  document: ColdSyncedDocument;
  execSql: ExecSql;
  projection: ContainerWriterProjectionResponse;
  recovered: Awaited<ReturnType<typeof createDocument>>;
  userId: string;
}) {
  const writerProjection = documentInfoProjection(input);
  const { response } = input.document;
  const attributionSegments = response.updates.flatMap((update) =>
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
      documentId: response.documentId,
      documentKekTargets: JSON.stringify(input.document.documentKekTargets),
      documentKind: "note",
      documentManifestBundle: JSON.stringify({
        manifestHash: input.document.contentKeyBundle.linkSetManifestHash,
      }),
      id: response.documentId,
      lastCommitLsn: response.commitLsn,
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
    localId: response.documentId,
    snapshot: bytesToBase64(exportFullHistorySnapshot(input.recovered)),
  });
  let attributionGetCount = 0;
  const info = await loadDocumentInfo({
    apiClient: {
      getDocumentEditAttribution: async (documentId) => {
        attributionGetCount += 1;
        if (documentId !== response.documentId) {
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
    localId: response.documentId,
    remoteInfoMode: "if-synced",
    reportSecurityIncident: async () => undefined,
  });

  return { attributionGetCount, info };
}
