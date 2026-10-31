import { KeyingVerificationError } from "@tearleads/crypto";
import {
  DEFAULT_DOCUMENT_KIND,
  DOCUMENTS_APP_KIND,
} from "../../../documents/documentConstants";
import type {
  DiscoveredDocumentInput,
  DocumentSummary,
} from "../../../documents/documentSummary";
import type { ClientSQLiteTransactionScope } from "../../../sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../../sqlite/sqlSchema";
import {
  type DocumentMovePlacement,
  loadDocumentMovePlacements,
} from "../../container-contents/documentPlacement";
import {
  hasDocumentPurgeCheckpointInTransaction,
  listPurgedDocumentIdsInTransaction,
} from "../../keyingCheckpoints/documentPurgeCheckpointPersistence";
import { findLocalIdByDocumentId, findLocalIdsByDocumentIds } from "../records";
import type { StoredDocumentRecord } from "../types";
import {
  discoveredDocumentPlacement,
  resolveDiscoveredDocumentPlacement,
} from "./discoveredDocumentPlacement";
import { toDocumentSummary } from "./documentProjectionRows";
import {
  documentSaveTimestampFrom,
  resolveDocumentSaveTimestamp,
  saveDocumentRows,
  saveDocumentRowsBatch,
} from "./documentRows";
import { resolvePersistedDocumentRuntimeState } from "./documentRuntimeState";
import { loadPendingCreateSummary } from "./pendingCreateAdoption";
import {
  loadStoredDocumentState,
  loadStoredDocumentStates,
  type StoredDocumentState,
} from "./rowQueryPersistence";

const DISCOVERED_DOCUMENT_PLACEHOLDER_TITLE = "Syncing document...";

function purgedDocumentError(): KeyingVerificationError {
  return new KeyingVerificationError(
    "rollback",
    "Document discovery targets a permanently purged document",
  );
}

function fenceSkippedError(): Error {
  return new Error("Document recovery generation changed during discovery");
}

function nextDiscoveredDocument(
  localId: string,
  input: DiscoveredDocumentInput,
  existingDocument: StoredDocumentRecord | null,
  placement: ReturnType<typeof discoveredDocumentPlacement>,
): StoredDocumentRecord {
  return {
    id: localId,
    documentId: input.documentId,
    documentKind: existingDocument?.documentKind ?? DEFAULT_DOCUMENT_KIND,
    text: existingDocument?.text ?? "",
    title: existingDocument?.title ?? DISCOVERED_DOCUMENT_PLACEHOLDER_TITLE,
    snapshotEndVersion: existingDocument?.snapshotEndVersion ?? "",
    recoveryGeneration: existingDocument?.recoveryGeneration ?? 0,
    ...placement,
    effectiveAccessLevel:
      input.effectiveAccessLevel ??
      existingDocument?.effectiveAccessLevel ??
      null,
    ...resolvePersistedDocumentRuntimeState(existingDocument, {
      accessEpoch: placement.accessEpoch,
      documentId: input.documentId,
    }),
  };
}

/** One discovered document, read and written on its own (the per-row path). */
async function upsertDiscoveredDocumentWithExec(
  execSql: ExecSql,
  input: DiscoveredDocumentInput,
  pendingCreates: ReadonlyMap<string, string>,
  tx: ClientSQLiteTransactionScope,
): Promise<DocumentSummary> {
  if (await hasDocumentPurgeCheckpointInTransaction(tx, input.documentId)) {
    throw purgedDocumentError();
  }
  const existingLocalId = await findLocalIdByDocumentId(
    execSql,
    DOCUMENTS_APP_KIND,
    input.documentId,
  );
  const localId = existingLocalId ?? input.documentId;
  const pendingLocalId = pendingCreates.get(input.documentId);
  if (!existingLocalId && pendingLocalId) {
    const pending = await loadPendingCreateSummary(execSql, pendingLocalId);
    if (!pending) throw new Error("Pending create projection is unavailable");
    return pending;
  }
  const existingDocument =
    (await loadStoredDocumentState(execSql, localId))?.record ?? null;
  const placement = await resolveDiscoveredDocumentPlacement(
    tx,
    existingDocument,
    input,
  );
  const nextDocument = nextDiscoveredDocument(
    localId,
    input,
    existingDocument,
    placement,
  );
  const updatedAt = await resolveDocumentSaveTimestamp({
    document: nextDocument,
    options: existingDocument ? undefined : { updatedAt: input.createdAt },
    tx,
  });
  if (!(await saveDocumentRows({ document: nextDocument, tx, updatedAt }))) {
    throw fenceSkippedError();
  }
  return toDocumentSummary(nextDocument, updatedAt);
}

async function upsertDiscoveredDocumentsPerRow(
  execSql: ExecSql,
  inputs: ReadonlyArray<DiscoveredDocumentInput>,
  pendingCreates: ReadonlyMap<string, string>,
  tx: ClientSQLiteTransactionScope,
): Promise<DocumentSummary[]> {
  const summaries: DocumentSummary[] = [];
  for (const input of inputs) {
    summaries.push(
      await upsertDiscoveredDocumentWithExec(
        execSql,
        input,
        pendingCreates,
        tx,
      ),
    );
  }
  return summaries;
}

type DiscoveryTarget =
  | { kind: "pending"; summary: DocumentSummary }
  | { input: DiscoveredDocumentInput; kind: "write"; localId: string };

/**
 * Resolves every input to its pending-create summary or its target local id,
 * in input order, so the first purged or unavailable input throws exactly as
 * the per-row walk would. Returns null when one input's write could change
 * another input's reads, which only the per-row walk handles.
 */
async function resolveDiscoveryTargets(
  execSql: ExecSql,
  inputs: ReadonlyArray<DiscoveredDocumentInput>,
  pendingCreates: ReadonlyMap<string, string>,
  tx: ClientSQLiteTransactionScope,
): Promise<DiscoveryTarget[] | null> {
  const documentIds = inputs.map((input) => input.documentId);
  const purged = await listPurgedDocumentIdsInTransaction(tx, documentIds);
  const existingLocalIds = await findLocalIdsByDocumentIds(
    execSql,
    DOCUMENTS_APP_KIND,
    documentIds,
  );
  const targets: DiscoveryTarget[] = [];
  const pendingLocalIds = new Set<string>();
  for (const input of inputs) {
    if (purged.has(input.documentId)) throw purgedDocumentError();
    const existingLocalId = existingLocalIds.get(input.documentId);
    const pendingLocalId = pendingCreates.get(input.documentId);
    if (!existingLocalId && pendingLocalId) {
      const pending = await loadPendingCreateSummary(execSql, pendingLocalId);
      if (!pending) throw new Error("Pending create projection is unavailable");
      pendingLocalIds.add(pendingLocalId);
      targets.push({ kind: "pending", summary: pending });
      continue;
    }
    targets.push({
      input,
      kind: "write",
      localId: existingLocalId ?? input.documentId,
    });
  }
  const writeLocalIds = targets.flatMap((target) =>
    target.kind === "write" ? [target.localId] : [],
  );
  const independent =
    new Set(writeLocalIds).size === writeLocalIds.length &&
    !writeLocalIds.some((localId) => pendingLocalIds.has(localId));
  return independent ? targets : null;
}

/**
 * Whether writing each target leaves every other target's reads unchanged: a
 * stored row at a target local id that carries a different document id would
 * be re-pointed by its write, which another input's lookup could have read.
 */
function targetsReadDisjointRows(
  targets: ReadonlyArray<DiscoveryTarget>,
  states: ReadonlyMap<string, StoredDocumentState>,
): boolean {
  return targets.every(
    (target) =>
      target.kind !== "write" ||
      (states.get(target.localId)?.record.documentId ??
        target.input.documentId) === target.input.documentId,
  );
}

function plannedDiscoveryWrite(
  target: Extract<DiscoveryTarget, { kind: "write" }>,
  state: StoredDocumentState | undefined,
  intent: DocumentMovePlacement | undefined,
) {
  const existingDocument = state?.record ?? null;
  const document = nextDiscoveredDocument(
    target.localId,
    target.input,
    existingDocument,
    discoveredDocumentPlacement(existingDocument, target.input, intent),
  );
  // The joined state read is the row and projection the per-row walk reads
  // again for its timestamp; nothing earlier in this transaction writes it.
  const updatedAt = state
    ? documentSaveTimestampFrom(
        {
          projection: state.projection,
          snapshotEndVersion: state.record.snapshotEndVersion,
        },
        document,
      )
    : target.input.createdAt;
  return { document, updatedAt };
}

/**
 * Discovery as set statements: one read per table for every input, then
 * multi-row upserts. Inputs whose rows could interact (a repeated document
 * id, a shared local id, or a row another input would re-point) keep the
 * per-row walk, which reads each input after the previous one's writes.
 */
export async function upsertDiscoveredDocumentsInTransaction(
  execSql: ExecSql,
  inputs: ReadonlyArray<DiscoveredDocumentInput>,
  pendingCreates: ReadonlyMap<string, string>,
  tx: ClientSQLiteTransactionScope,
): Promise<DocumentSummary[]> {
  const documentIds = inputs.map((input) => input.documentId);
  if (new Set(documentIds).size !== documentIds.length) {
    return upsertDiscoveredDocumentsPerRow(execSql, inputs, pendingCreates, tx);
  }
  const targets = await resolveDiscoveryTargets(
    execSql,
    inputs,
    pendingCreates,
    tx,
  );
  if (!targets) {
    return upsertDiscoveredDocumentsPerRow(execSql, inputs, pendingCreates, tx);
  }
  const writes = targets.flatMap((target) =>
    target.kind === "write" ? [target] : [],
  );
  if (writes.length === 0) {
    return targets.flatMap((target) =>
      target.kind === "pending" ? [target.summary] : [],
    );
  }
  const states = await loadStoredDocumentStates(
    execSql,
    writes.map((target) => target.localId),
  );
  if (!targetsReadDisjointRows(targets, states)) {
    return upsertDiscoveredDocumentsPerRow(execSql, inputs, pendingCreates, tx);
  }
  const intents = await loadDocumentMovePlacements(
    tx,
    writes.map((target) => target.input.documentId),
  );
  const planned = new Map(
    writes.map((target) => [
      target.localId,
      plannedDiscoveryWrite(
        target,
        states.get(target.localId),
        intents.get(target.input.documentId),
      ),
    ]),
  );
  const saved = await saveDocumentRowsBatch({
    entries: [...planned.values()],
    tx,
  });
  if (saved.size !== planned.size) throw fenceSkippedError();
  return targets.map((target) => {
    if (target.kind === "pending") return target.summary;
    const write = planned.get(target.localId);
    if (!write) throw new Error("Discovered document write is missing");
    return toDocumentSummary(write.document, write.updatedAt);
  });
}
