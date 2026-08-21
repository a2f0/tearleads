import { bytesToBase64 } from "@symcrypt/encoding";
import { exportFullHistorySnapshot } from "@symcrypt/loro";
import type {
  BlobAttachmentSummary,
  ContainerWriterProjectionResponse,
  DocumentEditAttributionResponse,
  DocumentWriterProjectionResponse,
  ListDocumentAttachmentsResponse,
} from "@symcrypt/validators/response";
import { and, eq, isNull } from "drizzle-orm";
import { DEFAULT_DOCUMENT_KIND } from "../../data/documents/documentConstants";
import {
  type DocumentBlameRange,
  type DocumentCharacterBlameSummary,
  type DocumentContributor,
  type DocumentFieldBlame,
  summarizeDocumentContributors,
} from "../../data/documents/editAttribution";
import { reportAndRethrowKeyingVerificationError } from "../../data/keyingProjectionVerification/error";
import { sqlDocumentsPersistence } from "../../data/persistence/documents/documentsPersistence";
import type { SecurityIncidentReporter } from "../../data/securityIncidents";
import {
  documentAttachmentBlobProjection,
  documentPendingAttachments,
  documentProjection,
} from "../../data/sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../data/sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { loadPersistedDocumentContent } from "../documents/historyContent";
import { computeDocumentBlame } from "./documentCharacterBlame";
import { computeFieldBlame } from "./documentFieldBlame";
import type {
  DocumentInfo,
  DocumentInfoAttachment,
  DocumentInfoAuthorizingContainerPath,
  DocumentInfoLocalDetails,
  DocumentInfoRemoteAttachmentBinding,
  DocumentInfoRemoteDetails,
  DocumentInfoRemoteMode,
} from "./documentInfoTypes";

export type {
  DocumentInfo,
  DocumentInfoAttachment,
  DocumentInfoAuthorizingContainerPath,
  DocumentInfoLocalDetails,
  DocumentInfoRemoteAttachmentBinding,
  DocumentInfoRemoteDetails,
  DocumentInfoRemoteMode,
} from "./documentInfoTypes";

interface DocumentInfoApi {
  getDocumentEditAttribution: (
    documentId: string,
    requestKey?: string,
  ) => Promise<DocumentEditAttributionResponse | null>;
  getDocumentWriterProjection: (
    documentId: string,
  ) => Promise<DocumentWriterProjectionResponse | null>;
  listDocumentAttachments: (
    documentId: string,
  ) => Promise<ListDocumentAttachmentsResponse | null>;
}

interface PendingAttachmentInfoRow {
  byteLength: number;
  createdAt: string;
  localId: string;
  mimeType: string | null;
  name: string;
  slotId: string;
  storageKey: string;
}

interface LocalAttachmentInfoRow {
  blobId: string | null;
  byteLength: number;
  localId: string;
  mimeType: string | null;
  slotId: string;
  storageKey: string;
  updatedAt: string;
}

function readRecordString(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const nextValue = Reflect.get(value, key);
  return typeof nextValue === "string" && nextValue.length > 0
    ? nextValue
    : null;
}

function readRecordNumber(value: unknown, key: string): number | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const nextValue = Reflect.get(value, key);
  return typeof nextValue === "number" && Number.isFinite(nextValue)
    ? nextValue
    : null;
}

function readRecordArrayLength(value: unknown, key: string): number | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const nextValue = Reflect.get(value, key);
  return Array.isArray(nextValue) ? nextValue.length : null;
}

function readStoredManifestHash(
  value: string | null | undefined,
): string | null {
  if (!value) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(value);
    return readRecordString(parsed, "manifestHash");
  } catch {
    return null;
  }
}

function mapPendingAttachmentRow(
  row: PendingAttachmentInfoRow,
): DocumentInfoAttachment {
  return {
    attachmentKind: "pending",
    blobId: null,
    byteLength: row.byteLength,
    createdAt: row.createdAt,
    localId: row.localId,
    mimeType: row.mimeType,
    name: row.name,
    slotId: row.slotId,
    storageKey: row.storageKey,
    updatedAt: null,
  };
}

function mapLocalAttachmentRow(
  row: LocalAttachmentInfoRow,
): DocumentInfoAttachment {
  return {
    attachmentKind: "local",
    blobId: row.blobId,
    byteLength: row.byteLength,
    createdAt: null,
    localId: row.localId,
    mimeType: row.mimeType,
    name: null,
    slotId: row.slotId,
    storageKey: row.storageKey,
    updatedAt: row.updatedAt,
  };
}

async function loadDocumentInfoAttachments(input: {
  execSql: ExecSql;
  localId: string;
}): Promise<DocumentInfoAttachment[]> {
  const { db } = getClientSQLitePersistenceRuntime(input.execSql);
  const [pendingRows, localRows] = await Promise.all([
    db
      .select({
        byteLength: documentPendingAttachments.byteLength,
        createdAt: documentPendingAttachments.createdAt,
        localId: documentPendingAttachments.localId,
        mimeType: documentPendingAttachments.mimeType,
        name: documentPendingAttachments.name,
        slotId: documentPendingAttachments.slotId,
        storageKey: documentPendingAttachments.storageKey,
      })
      .from(documentPendingAttachments)
      .where(eq(documentPendingAttachments.localId, input.localId))
      .orderBy(
        documentPendingAttachments.createdAt,
        documentPendingAttachments.slotId,
      ),
    db
      .select({
        blobId: documentAttachmentBlobProjection.blobId,
        byteLength: documentAttachmentBlobProjection.byteLength,
        localId: documentAttachmentBlobProjection.localId,
        mimeType: documentAttachmentBlobProjection.mimeType,
        slotId: documentAttachmentBlobProjection.slotId,
        storageKey: documentAttachmentBlobProjection.storageKey,
        updatedAt: documentAttachmentBlobProjection.updatedAt,
      })
      .from(documentAttachmentBlobProjection)
      .where(
        and(
          eq(documentAttachmentBlobProjection.localId, input.localId),
          // Unlinked slots keep their row as a pending-detach marker; the
          // document no longer has the attachment, so do not report it.
          isNull(documentAttachmentBlobProjection.detachedAt),
        ),
      )
      .orderBy(
        documentAttachmentBlobProjection.updatedAt,
        documentAttachmentBlobProjection.slotId,
      ),
  ]);

  return [
    ...pendingRows.map(mapPendingAttachmentRow),
    ...localRows.map(mapLocalAttachmentRow),
  ];
}

async function loadLocalDocumentInfo(input: {
  execSql: ExecSql | null;
  localId: string;
}): Promise<{
  attachments: DocumentInfoAttachment[];
  contentSnapshot: string | null;
  local: DocumentInfoLocalDetails;
}> {
  const fallback = {
    attachments: [],
    contentSnapshot: null,
    local: {
      accessEpoch: null,
      accessStateHash: null,
      containerId: null,
      documentId: null,
      documentKind: null,
      hasContentKeyBundle: false,
      hasDocumentKekTargets: false,
      hasDocumentManifestBundle: false,
      lastCommitLsn: null,
      localDocumentManifestHash: null,
      localId: input.localId,
      pendingAttachmentByteLength: 0,
      pendingAttachmentCount: 0,
      pendingUpdateCount: 0,
      title: null,
      updatedAt: null,
    },
  };

  if (!input.execSql) {
    return fallback;
  }

  await sqlDocumentsPersistence.ensureSchema(input.execSql);
  const { db } = getClientSQLitePersistenceRuntime(input.execSql);
  const [document, pendingUpdates, attachments, projectionRows, contentDoc] =
    await Promise.all([
      sqlDocumentsPersistence.loadDocument(input.execSql, input.localId),
      sqlDocumentsPersistence.listPendingUpdates(input.execSql, input.localId),
      loadDocumentInfoAttachments({
        execSql: input.execSql,
        localId: input.localId,
      }),
      db
        .select({ updatedAt: documentProjection.updatedAt })
        .from(documentProjection)
        .where(eq(documentProjection.localId, input.localId))
        .limit(1),
      loadPersistedDocumentContent({
        execSql: input.execSql,
        localId: input.localId,
        persistence: sqlDocumentsPersistence,
      }).catch(() => null),
    ]);

  if (!document) {
    return fallback;
  }

  const pendingAttachments = attachments.filter(
    (attachment) => attachment.attachmentKind === "pending",
  );

  return {
    attachments,
    // Blame reads op-level provenance out of a serialized snapshot; export the
    // durable-history content for it. Degrades to null (blame unavailable)
    // rather than failing the Info panel.
    contentSnapshot: contentDoc
      ? bytesToBase64(exportFullHistorySnapshot(contentDoc))
      : null,
    local: {
      accessEpoch: document.accessEpoch,
      accessStateHash: document.accessStateHash ?? null,
      containerId: document.containerId,
      documentId: document.documentId,
      documentKind: document.documentKind ?? DEFAULT_DOCUMENT_KIND,
      hasContentKeyBundle: Boolean(document.contentKeyBundle),
      hasDocumentKekTargets: Boolean(document.documentKekTargets),
      hasDocumentManifestBundle: Boolean(document.documentManifestBundle),
      lastCommitLsn: document.lastCommitLsn ?? null,
      localDocumentManifestHash: readStoredManifestHash(
        document.documentManifestBundle,
      ),
      localId: document.id,
      pendingAttachmentByteLength: pendingAttachments.reduce(
        (total, attachment) => total + attachment.byteLength,
        0,
      ),
      pendingAttachmentCount: pendingAttachments.length,
      pendingUpdateCount: pendingUpdates.length,
      title: document.title ?? null,
      updatedAt: projectionRows[0]?.updatedAt ?? null,
    },
  };
}

function shouldLoadRemoteDocumentInfo(input: {
  local: DocumentInfoLocalDetails;
  remoteInfoMode: DocumentInfoRemoteMode;
}): boolean {
  return input.remoteInfoMode !== "never" && Boolean(input.local.documentId);
}

function mapAttachmentBinding(
  binding: BlobAttachmentSummary,
): DocumentInfoRemoteAttachmentBinding {
  return {
    bindingId: binding.bindingId,
    blobId: binding.blobId,
    slotId: binding.slotId,
  };
}

function mapAuthorizingContainerPath(
  projection: ContainerWriterProjectionResponse,
): DocumentInfoAuthorizingContainerPath {
  const leafBundle = projection.path.at(-1);
  const leafKek = projection.containerKeks.at(-1);

  return {
    containerId: projection.containerId,
    containerKeyEpoch: leafKek?.containerKeyEpoch ?? null,
    containerKeyEpochId: leafKek?.containerKeyEpochId ?? null,
    leafManifestHash: leafBundle?.manifestHash ?? null,
    organizationId: projection.organizationId,
    pathLength: projection.path.length,
  };
}

function getDocumentInfoRemoteDetails(input: {
  attachmentBindings: ReadonlyArray<BlobAttachmentSummary>;
  attribution: DocumentEditAttributionResponse | null;
  blameRanges: DocumentBlameRange[] | null;
  characterBlame: DocumentCharacterBlameSummary | null;
  contributors: DocumentContributor[];
  fieldBlame: DocumentFieldBlame[] | null;
  projection: DocumentWriterProjectionResponse;
}): DocumentInfoRemoteDetails {
  const {
    attachmentBindings,
    attribution,
    blameRanges,
    characterBlame,
    contributors,
    fieldBlame,
    projection,
  } = input;
  const manifestState = projection.documentManifest.state;
  const manifest = projection.documentManifest.manifest;

  return {
    activeAttachmentBindings: attachmentBindings.map(mapAttachmentBinding),
    attributionRevision: attribution?.attributionRevision ?? null,
    attributionStatus: attribution
      ? attribution.truncated
        ? "truncated"
        : "available"
      : "unavailable",
    attributionSegments: attribution?.segments ?? [],
    authorizingContainerPaths: projection.authorizingContainerPaths.map(
      mapAuthorizingContainerPath,
    ),
    blameRanges,
    characterBlame,
    fieldBlame,
    contentKeyEpoch: projection.contentKeyBundle.contentKeyEpoch,
    contentKeyTargetCount: projection.contentKeyBundle.targets.length,
    contentKeyTargetHash: projection.contentKeyBundle.targetHash,
    contributors,
    currentManifestHash: projection.documentManifest.manifestHash,
    documentContainerManifestHistoryCount:
      projection.documentContainerManifestHistory.length,
    documentKekTargetCount: projection.documentKekTargets.targets.length,
    documentKeyTargetHash: projection.documentKekTargets.documentKeyTargetHash,
    documentManifestContainerPathCount:
      projection.documentManifestContainerPaths.length,
    documentManifestHistoryCount: projection.documentManifestHistory.length,
    linkedContainerKeyEpochCount:
      projection.documentKekTargets.linkedContainerKeyEpochIds.length,
    linkedContainerManifestCount:
      projection.documentKekTargets.linkedContainerManifestHashes.length,
    linkSetManifestHash: projection.documentKekTargets.linkSetManifestHash,
    manifestEpoch: readRecordNumber(manifest, "epoch"),
    previousManifestHash: readRecordString(
      manifestState,
      "previousManifestHash",
    ),
    referencedPrincipalCount: readRecordArrayLength(
      manifest,
      "referencedPrincipalHeads",
    ),
  };
}

export async function loadDocumentInfo(input: {
  apiClient: DocumentInfoApi;
  attributionRequestKey?: string | undefined;
  execSql?: ExecSql | null;
  localId: string;
  reportSecurityIncident: SecurityIncidentReporter;
  remoteInfoMode?: DocumentInfoRemoteMode | undefined;
}): Promise<DocumentInfo> {
  const { attachments, contentSnapshot, local } = await loadLocalDocumentInfo({
    execSql: input.execSql ?? null,
    localId: input.localId,
  });

  if (
    !shouldLoadRemoteDocumentInfo({
      local,
      remoteInfoMode: input.remoteInfoMode ?? "if-synced",
    }) ||
    !local.documentId
  ) {
    return { attachments, local, remoteInfo: null };
  }

  const attributionPromise = input.apiClient
    .getDocumentEditAttribution(local.documentId, input.attributionRequestKey)
    .catch(async (error: unknown) => {
      await reportAndRethrowKeyingVerificationError(
        error,
        input.reportSecurityIncident,
        {
          objectId: local.documentId ?? input.localId,
          objectKind: "document",
          operation: "document.info.attribution",
        },
      );
      return null;
    });
  const [projection, attachmentBindings, attribution] = await Promise.all([
    input.apiClient.getDocumentWriterProjection(local.documentId),
    input.apiClient.listDocumentAttachments(local.documentId),
    // Attribution is supplementary: a rejection (network/server) must not block
    // the rest of the document-info load, so swallow it to null (no contributors).
    attributionPromise,
  ]);

  if (!projection) {
    throw new Error(
      `Document info projection was unavailable for local document ${input.localId} with remote document ${local.documentId}.`,
    );
  }

  const attributionComplete = attribution && !attribution.truncated;
  const attributionSegments = attribution?.segments ?? [];
  const blame = attributionComplete
    ? computeDocumentBlame(contentSnapshot, attributionSegments)
    : null;
  return {
    attachments,
    local,
    remoteInfo: getDocumentInfoRemoteDetails({
      attachmentBindings: attachmentBindings ?? [],
      attribution,
      blameRanges: blame?.blameRanges ?? null,
      characterBlame: blame?.characterBlame ?? null,
      contributors: attributionComplete
        ? summarizeDocumentContributors(attributionSegments)
        : [],
      fieldBlame: attributionComplete
        ? computeFieldBlame(contentSnapshot, attributionSegments)
        : null,
      projection,
    }),
  };
}
