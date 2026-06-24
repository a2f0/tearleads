import type {
  BlobAttachmentSummary,
  ContainerWriterProjectionResponse,
  DocumentEditAttributionResponse,
  DocumentWriterProjectionResponse,
  ListDocumentAttachmentsResponse,
} from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import { DEFAULT_DOCUMENT_KIND } from "../../data/documents/documentConstants";
import type { StoredDocumentKind } from "../../data/documents/documentKinds";
import {
  type DocumentContributor,
  summarizeDocumentContributors,
} from "../../data/documents/editAttribution";
import { sqlDocumentsPersistence } from "../../data/persistence/documents/documentsPersistence";
import {
  documentAttachmentBlobProjection,
  documentPendingAttachments,
  documentProjection,
} from "../../data/sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../data/sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../data/sqlite/sqlSchema";

export type DocumentInfoRemoteMode = "if-synced" | "never";

export interface DocumentInfoLocalDetails {
  accessEpoch: number | null;
  accessStateHash: string | null;
  containerId: string | null;
  documentId: string | null;
  documentKind: StoredDocumentKind | null;
  hasContentKeyBundle: boolean;
  hasDocumentKekTargets: boolean;
  hasDocumentManifestBundle: boolean;
  lastCommitLsn: string | null;
  localDocumentManifestHash: string | null;
  localId: string;
  pendingAttachmentByteLength: number;
  pendingAttachmentCount: number;
  pendingUpdateCount: number;
  title: string | null;
  updatedAt: string | null;
}

export interface DocumentInfoAttachment {
  attachmentKind: "local" | "pending";
  blobId: string | null;
  byteLength: number;
  createdAt: string | null;
  localId: string;
  mimeType: string | null;
  name: string | null;
  slotId: string;
  storageKey: string;
  updatedAt: string | null;
}

export interface DocumentInfoRemoteAttachmentBinding {
  bindingId: string;
  blobId: string;
  slotId: string;
}

export interface DocumentInfoAuthorizingContainerPath {
  containerId: string;
  containerKeyEpoch: number | null;
  containerKeyEpochId: string | null;
  leafManifestHash: string | null;
  organizationId: string;
  pathLength: number;
}

export interface DocumentInfoRemoteDetails {
  activeAttachmentBindings: DocumentInfoRemoteAttachmentBinding[];
  authorizingContainerPaths: DocumentInfoAuthorizingContainerPath[];
  contentKeyEpoch: number;
  contentKeyTargetCount: number;
  contentKeyTargetHash: string;
  contributors: DocumentContributor[];
  currentManifestHash: string;
  documentContainerManifestHistoryCount: number;
  documentKekTargetCount: number;
  documentKeyTargetHash: string;
  documentManifestContainerPathCount: number;
  documentManifestHistoryCount: number;
  linkedContainerKeyEpochCount: number;
  linkedContainerManifestCount: number;
  linkSetManifestHash: string;
  manifestEpoch: number | null;
  previousManifestHash: string | null;
  referencedPrincipalCount: number | null;
}

export interface DocumentInfo {
  attachments: DocumentInfoAttachment[];
  local: DocumentInfoLocalDetails;
  remoteInfo: DocumentInfoRemoteDetails | null;
}

interface DocumentInfoApi {
  getDocumentEditAttribution: (
    documentId: string,
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
      .where(eq(documentAttachmentBlobProjection.localId, input.localId))
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
  local: DocumentInfoLocalDetails;
}> {
  const fallback = {
    attachments: [],
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
  const [document, pendingUpdates, attachments, projectionRows] =
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
    ]);

  if (!document) {
    return fallback;
  }

  const pendingAttachments = attachments.filter(
    (attachment) => attachment.attachmentKind === "pending",
  );

  return {
    attachments,
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
  contributors: DocumentContributor[];
  projection: DocumentWriterProjectionResponse;
}): DocumentInfoRemoteDetails {
  const { attachmentBindings, contributors, projection } = input;
  const manifestState = projection.documentManifest.state;
  const manifest = projection.documentManifest.manifest;

  return {
    activeAttachmentBindings: attachmentBindings.map(mapAttachmentBinding),
    authorizingContainerPaths: projection.authorizingContainerPaths.map(
      mapAuthorizingContainerPath,
    ),
    contentKeyEpoch: projection.contentKeyBundle.contentKeyEpoch,
    contentKeyTargetCount: projection.contentKeyBundle.targets.length,
    contentKeyTargetHash: projection.contentKeyBundle.targetHash,
    contributors,
    currentManifestHash: projection.documentManifest.manifestHash,
    documentContainerManifestHistoryCount:
      projection.documentContainerManifestHistory?.length ?? 0,
    documentKekTargetCount: projection.documentKekTargets.targets.length,
    documentKeyTargetHash: projection.documentKekTargets.documentKeyTargetHash,
    documentManifestContainerPathCount:
      projection.documentManifestContainerPaths?.length ?? 0,
    documentManifestHistoryCount:
      projection.documentManifestHistory?.length ?? 0,
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
  execSql?: ExecSql | null;
  localId: string;
  remoteInfoMode?: DocumentInfoRemoteMode | undefined;
}): Promise<DocumentInfo> {
  const { attachments, local } = await loadLocalDocumentInfo({
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

  const [projection, attachmentBindings, attribution] = await Promise.all([
    input.apiClient.getDocumentWriterProjection(local.documentId),
    input.apiClient.listDocumentAttachments(local.documentId),
    // Attribution is supplementary: a rejection (network/server) must not block
    // the rest of the document-info load, so swallow it to null (no contributors).
    input.apiClient
      .getDocumentEditAttribution(local.documentId)
      .catch(() => null),
  ]);

  if (!projection) {
    throw new Error(
      `Document info projection was unavailable for local document ${input.localId} with remote document ${local.documentId}.`,
    );
  }

  return {
    attachments,
    local,
    remoteInfo: getDocumentInfoRemoteDetails({
      attachmentBindings: attachmentBindings ?? [],
      contributors: attribution
        ? summarizeDocumentContributors(attribution.segments)
        : [],
      projection,
    }),
  };
}
