import { type AccessEvent, readKeyingCanonicalJson } from "@tearleads/crypto";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import { and, eq, inArray } from "drizzle-orm";
import {
  documentBaselineStageTables,
  documentBaselineStageUploads,
} from "../../../sqlite/schema/documentBaselineStageSchema";
import { documents } from "../../../sqlite/schema/documentRecordSchema";
import { sqliteRowsPerStatement } from "../../../sqlite/sqliteBindBudget";
import {
  afterClientSQLiteScopeCommit,
  type ClientSQLiteTransactionScope,
  getClientSQLitePersistenceRuntime,
} from "../../../sqlite/sqlitePersistenceRuntime";
import {
  type ExecSql,
  ensureSqlTables,
  resolveCanonicalExecSql,
} from "../../../sqlite/sqlSchema";

const DOCUMENT_IDS_PER_STATEMENT = sqliteRowsPerStatement(1, 0);
const SCOPE_LOCAL_IDS_PER_STATEMENT = sqliteRowsPerStatement(1, 1);
const CONTENT_KEY_BYTES = 32;

type StagedBaselineEvictionListener = (documentIds: readonly string[]) => void;

const evictionListenersByDatabase = new WeakMap<
  ExecSql,
  Set<StagedBaselineEvictionListener>
>();

/** Subscribe to committed document-row evictions on `execSql`. */
export function onDocumentStagedBaselineUploadsEvicted(
  execSql: ExecSql,
  listener: StagedBaselineEvictionListener,
): () => void {
  const canonical = resolveCanonicalExecSql(execSql);
  let listeners = evictionListenersByDatabase.get(canonical);
  if (!listeners) {
    listeners = new Set();
    evictionListenersByDatabase.set(canonical, listeners);
  }
  listeners.add(listener);
  return () => {
    listeners?.delete(listener);
  };
}

function notifyDocumentStagedBaselineUploadsEvicted(
  canonicalExecSql: ExecSql,
  documentIds: readonly string[],
): void {
  if (documentIds.length === 0) return;
  const listeners = evictionListenersByDatabase.get(canonicalExecSql);
  if (!listeners) return;
  for (const listener of listeners) listener(documentIds);
}

/**
 * Persisted record of one staged segment: enough to confirm a re-proven
 * history against the stage, re-sign its header, and carry the digest
 * forward. Never holds ciphertext.
 */
export interface PersistedStagedSegmentRecord {
  readonly ciphertextHash: string;
  readonly contentRecordId: string;
  readonly dependencyVersionVector: string;
  readonly digestAfter: string;
  readonly metadataHash: string;
  readonly partialEndVersionVector: string;
  readonly partialStartVersionVector: string;
  readonly plaintextHash: string;
  readonly updateId: string;
}

/** One container key epoch a staged upload's rotation key was wrapped for. */
export interface PersistedRotationKeyTarget {
  readonly containerId: string;
  readonly containerKeyEpochId: string;
}

/** Durable snapshot of one document's staged rotation baseline upload. */
export interface PersistedStagedBaselineUpload {
  readonly baselineId: string;
  readonly contentKey: Uint8Array;
  readonly contentKeyCommitment: string;
  readonly contentKeyEpoch: number;
  readonly documentId: string;
  readonly headersSignedFor: string | null;
  readonly keyTargets: readonly PersistedRotationKeyTarget[];
  readonly linkSetEvent: AccessEvent | undefined;
  readonly records: readonly PersistedStagedSegmentRecord[];
  readonly signedAt: string;
}

function readStringField(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function parseSegmentRecords(
  json: string,
): readonly PersistedStagedSegmentRecord[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const records: PersistedStagedSegmentRecord[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const rec = item as Record<string, unknown>;
    const ciphertextHash = readStringField(rec, "ciphertextHash");
    const contentRecordId = readStringField(rec, "contentRecordId");
    const dependencyVersionVector = readStringField(
      rec,
      "dependencyVersionVector",
    );
    const digestAfter = readStringField(rec, "digestAfter");
    const metadataHash = readStringField(rec, "metadataHash");
    const partialEndVersionVector = readStringField(
      rec,
      "partialEndVersionVector",
    );
    const partialStartVersionVector = readStringField(
      rec,
      "partialStartVersionVector",
    );
    const plaintextHash = readStringField(rec, "plaintextHash");
    const updateId = readStringField(rec, "updateId");
    if (
      ciphertextHash === null ||
      contentRecordId === null ||
      dependencyVersionVector === null ||
      digestAfter === null ||
      metadataHash === null ||
      partialEndVersionVector === null ||
      partialStartVersionVector === null ||
      plaintextHash === null ||
      updateId === null
    ) {
      return null;
    }
    records.push({
      ciphertextHash,
      contentRecordId,
      dependencyVersionVector,
      digestAfter,
      metadataHash,
      partialEndVersionVector,
      partialStartVersionVector,
      plaintextHash,
      updateId,
    });
  }
  return records;
}

function parseKeyTargets(
  json: string,
): readonly PersistedRotationKeyTarget[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return null;
  const targets: PersistedRotationKeyTarget[] = [];
  for (const item of parsed) {
    if (
      !Array.isArray(item) ||
      item.length !== 2 ||
      typeof item[0] !== "string" ||
      typeof item[1] !== "string" ||
      item[0].length === 0 ||
      item[1].length === 0
    ) {
      return null;
    }
    targets.push({ containerId: item[0], containerKeyEpochId: item[1] });
  }
  return targets;
}

function parseLinkSetEvent(
  json: string | null,
): AccessEvent | null | undefined {
  if (json === null) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const event = parsed as Record<string, unknown>;
  const eventId = readStringField(event, "eventId");
  const signedAt = readStringField(event, "signedAt");
  const signature = readStringField(event, "signature");
  if (!eventId || !signedAt || !signature) {
    return null;
  }
  const { signature: _signature, ...fields } = event;
  try {
    readKeyingCanonicalJson(fields, "Persisted link-set event");
  } catch {
    return null;
  }
  return parsed as AccessEvent;
}

function decodeContentKey(base64: string): Uint8Array | null {
  try {
    const bytes = base64ToBytes(base64);
    return bytes.byteLength === CONTENT_KEY_BYTES ? bytes : null;
  } catch {
    return null;
  }
}

function deserializeRow(
  row: typeof documentBaselineStageUploads.$inferSelect,
): PersistedStagedBaselineUpload | null {
  if (
    row.documentId.length === 0 ||
    row.baselineId.length === 0 ||
    row.contentKeyCommitment.length === 0 ||
    row.signedAt.length === 0 ||
    !Number.isSafeInteger(row.contentKeyEpoch) ||
    row.contentKeyEpoch <= 0
  ) {
    return null;
  }
  const contentKey = decodeContentKey(row.contentKeyBase64);
  const keyTargets = parseKeyTargets(row.keyTargetsJson);
  const records = parseSegmentRecords(row.recordsJson);
  const linkSetEvent = parseLinkSetEvent(row.linkSetEventJson);
  if (!contentKey || !keyTargets || !records || linkSetEvent === null) {
    return null;
  }
  return {
    baselineId: row.baselineId,
    contentKey,
    contentKeyCommitment: row.contentKeyCommitment,
    contentKeyEpoch: row.contentKeyEpoch,
    documentId: row.documentId,
    headersSignedFor: row.headersSignedFor,
    keyTargets,
    linkSetEvent,
    records,
    signedAt: row.signedAt,
  };
}

/** Ensure the local staged-baseline table exists on `execSql`. */
export function ensureDocumentBaselineStageTables(
  execSql: ExecSql,
): Promise<void> {
  return ensureSqlTables(execSql, documentBaselineStageTables);
}

/**
 * Load every valid persisted staged baseline upload from `execSql`. Any row
 * whose stored fields fail validation is deleted and skipped so corrupt
 * durable state never blocks a fresh upload.
 */
export async function loadDocumentStagedBaselineUploads(
  execSql: ExecSql,
  isValidUpload: (
    upload: PersistedStagedBaselineUpload,
  ) => Promise<boolean> | boolean,
): Promise<Map<string, PersistedStagedBaselineUpload>> {
  await ensureDocumentBaselineStageTables(execSql);
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const rows = await db.select().from(documentBaselineStageUploads).all();
  const uploads = new Map<string, PersistedStagedBaselineUpload>();
  const invalidIds: string[] = [];
  for (const row of rows) {
    const parsed = deserializeRow(row);
    if (!parsed || !(await isValidUpload(parsed))) {
      invalidIds.push(row.documentId);
      continue;
    }
    uploads.set(parsed.documentId, parsed);
  }
  if (invalidIds.length > 0) {
    await getClientSQLitePersistenceRuntime(execSql).runMutation((tx) =>
      deleteDocumentStagedBaselineUploadsInTransaction(tx, invalidIds),
    );
  }
  return uploads;
}

/** Upsert one document's staged baseline upload state before using it. */
export async function saveDocumentStagedBaselineUpload(
  execSql: ExecSql,
  upload: PersistedStagedBaselineUpload,
): Promise<void> {
  await ensureDocumentBaselineStageTables(execSql);
  const row: typeof documentBaselineStageUploads.$inferInsert = {
    baselineId: upload.baselineId,
    contentKeyBase64: bytesToBase64(upload.contentKey),
    contentKeyCommitment: upload.contentKeyCommitment,
    contentKeyEpoch: upload.contentKeyEpoch,
    documentId: upload.documentId,
    headersSignedFor: upload.headersSignedFor,
    keyTargetsJson: JSON.stringify(
      upload.keyTargets.map(({ containerId, containerKeyEpochId }) => [
        containerId,
        containerKeyEpochId,
      ]),
    ),
    linkSetEventJson:
      upload.linkSetEvent === undefined
        ? null
        : JSON.stringify(upload.linkSetEvent),
    recordsJson: JSON.stringify(upload.records),
    signedAt: upload.signedAt,
    updatedAt: new Date().toISOString(),
  };
  await getClientSQLitePersistenceRuntime(execSql).runMutation(async (tx) => {
    await tx
      .insert(documentBaselineStageUploads)
      .values(row)
      .onConflictDoUpdate({
        set: row,
        target: [documentBaselineStageUploads.documentId],
      })
      .run();
  });
}

/** Delete one document's persisted staged baseline upload, if any. */
export async function deleteDocumentStagedBaselineUpload(
  execSql: ExecSql,
  documentId: string,
): Promise<void> {
  await ensureDocumentBaselineStageTables(execSql);
  await getClientSQLitePersistenceRuntime(execSql).runMutation(async (tx) => {
    await tx
      .delete(documentBaselineStageUploads)
      .where(eq(documentBaselineStageUploads.documentId, documentId))
      .run();
  });
}

/** Delete persisted staged baseline uploads for `documentIds` in a transaction. */
export async function deleteDocumentStagedBaselineUploadsInTransaction(
  tx: Pick<ClientSQLiteTransactionScope, "delete">,
  documentIds: readonly string[],
): Promise<void> {
  const unique = [...new Set(documentIds)];
  if (unique.length === 0) return;
  for (
    let offset = 0;
    offset < unique.length;
    offset += DOCUMENT_IDS_PER_STATEMENT
  ) {
    await tx
      .delete(documentBaselineStageUploads)
      .where(
        inArray(
          documentBaselineStageUploads.documentId,
          unique.slice(offset, offset + DOCUMENT_IDS_PER_STATEMENT),
        ),
      )
      .run();
  }
  afterClientSQLiteScopeCommit(tx, (canonical) => {
    notifyDocumentStagedBaselineUploadsEvicted(canonical, unique);
  });
}

/**
 * Look up server document ids for `(appKind, localIds)` and delete any
 * persisted staged baseline uploads they own, inside the caller's transaction.
 */
export async function deleteDocumentStagedBaselineUploadsForScopesInTransaction(
  tx: Pick<ClientSQLiteTransactionScope, "delete" | "select">,
  appKind: string,
  localIds: readonly string[],
): Promise<void> {
  const ids = [...new Set(localIds)];
  if (ids.length === 0) return;
  const documentIds: string[] = [];
  for (
    let offset = 0;
    offset < ids.length;
    offset += SCOPE_LOCAL_IDS_PER_STATEMENT
  ) {
    const rows = await tx
      .select({ documentId: documents.documentId })
      .from(documents)
      .where(
        and(
          eq(documents.appKind, appKind),
          inArray(
            documents.localId,
            ids.slice(offset, offset + SCOPE_LOCAL_IDS_PER_STATEMENT),
          ),
        ),
      )
      .all();
    for (const row of rows) {
      if (row.documentId !== null && row.documentId.length > 0) {
        documentIds.push(row.documentId);
      }
    }
  }
  await deleteDocumentStagedBaselineUploadsInTransaction(tx, documentIds);
}
