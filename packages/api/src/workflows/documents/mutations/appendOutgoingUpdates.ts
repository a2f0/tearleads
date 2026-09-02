import { Buffer } from "node:buffer";
import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import { documentUpdates } from "@tearleads/api-shared/schema";
import type { WriteHeader } from "@tearleads/crypto";
import type {
  DocumentOutgoingUpdate,
  DocumentSyncRequest,
} from "@tearleads/validators/request";
import { inArray } from "drizzle-orm";
import { listDocumentContentWriteHeaders } from "../../../access/read/documentContentKeyStore";
import { storeDocumentContentWriteHeader } from "../../../access/write/documentContentKeyStore";
import { maybeWriteDocumentAuditCheckpoint } from "../../../documents/documentAuditCheckpoints";
import { appendDocumentUpdateAuditEntries } from "../../../documents/documentAuditEntries";
import { insertDocumentUpdateSpans } from "../../../documents/documentUpdateSpans";
import { uniqueSortedStrings } from "../../../utils/array";
import { DocumentMutationError, documentUpdateIdConflict } from "./errors";
import {
  assertRetryUpdateMatchesAcceptedContent,
  storedDocumentUpdateMatchesOutgoingContent,
  uniqueOutgoingUpdates,
  verifyOutgoingWriteHeader,
} from "./outgoingUpdateVerification";
import type { AppendDocumentUpdatesInput } from "./types";

/**
 * Dedup, idempotent-retry matching, insertion, and audit of a sync request's
 * outgoing updates. Split from syncDocument.ts, which keeps the transaction
 * orchestration; per-update verification lives in outgoingUpdateVerification.
 */
function documentUpdateByteLength(update: DocumentOutgoingUpdate): number {
  return Buffer.byteLength(update.encryptedData, "utf8");
}

function acceptedOutgoingUpdateIds(
  updates: readonly DocumentOutgoingUpdate[],
  acceptedUpdateIds: ReadonlySet<string>,
): string[] {
  return updates
    .filter((update) => acceptedUpdateIds.has(update.id))
    .map((update) => update.id);
}

async function insertNewDocumentUpdates(input: {
  readonly accessEpoch: number;
  readonly documentId: string;
  readonly executor: DatabaseTransaction;
  readonly fingerprint: string;
  readonly updates: readonly DocumentOutgoingUpdate[];
}): Promise<ReadonlySet<string>> {
  if (input.updates.length === 0) {
    return new Set<string>();
  }

  // A concurrent request (a client retry racing its own in-flight submission,
  // or two devices flushing a shared outbox) can commit the same update id
  // between loadExistingDocumentUpdateRows and this insert. Skip those rows
  // instead of surfacing the driver's unique-violation 500; the caller
  // byte-compares every skipped id against the committed row.
  const insertedRows = await input.executor
    .insert(documentUpdates)
    .values(
      input.updates.map((update) => ({
        id: update.id,
        documentId: input.documentId,
        accessEpoch: input.accessEpoch,
        authorFingerprint: input.fingerprint,
        encryptedData: update.encryptedData,
        byteLength: documentUpdateByteLength(update),
        partialStartVersionVector: update.partialStartVersionVector,
        partialEndVersionVector: update.partialEndVersionVector,
        plaintextHash: update.plaintextHash,
      })),
    )
    .onConflictDoNothing({ target: documentUpdates.id })
    .returning({ id: documentUpdates.id });
  const insertedUpdateIds = new Set(insertedRows.map((row) => row.id));
  await insertDocumentUpdateSpans(input.executor, {
    documentId: input.documentId,
    updates: input.updates.filter((update) => insertedUpdateIds.has(update.id)),
  });

  return insertedUpdateIds;
}

async function appendAuditEntriesForNewDocumentUpdates(input: {
  readonly accessEpoch: number;
  readonly accessManifestHash: string;
  readonly accessStateHash: string | null;
  readonly documentId: string;
  readonly executor: DatabaseTransaction;
  readonly fingerprint: string;
  readonly updates: readonly DocumentOutgoingUpdate[];
  readonly userId: string;
}): Promise<void> {
  if (input.updates.length === 0) {
    return;
  }

  const auditEntryHashByUpdateId = await appendDocumentUpdateAuditEntries(
    input.executor,
    {
      accessEpoch: input.accessEpoch,
      accessManifestHash: input.accessManifestHash,
      accessStateHash: input.accessStateHash,
      actorFingerprint: input.fingerprint,
      actorUserId: input.userId,
      documentId: input.documentId,
      updates: input.updates,
    },
  );

  for (const update of input.updates) {
    const coveredAuditEntryHash = auditEntryHashByUpdateId.get(update.id);
    if (update.checkpointKind) {
      if (!coveredAuditEntryHash) {
        const message = `Missing audit entry hash for checkpoint update ${update.id}`;
        throw new DocumentMutationError(message, 409);
      }
      await maybeWriteDocumentAuditCheckpoint(input.executor, {
        accessEpoch: input.accessEpoch,
        accessManifestHash: input.accessManifestHash,
        accessStateHash: input.accessStateHash,
        actorFingerprint: input.fingerprint,
        actorUserId: input.userId,
        checkpointUpdate: update,
        coveredAuditEntryHash,
        documentId: input.documentId,
      });
    }
  }
}

async function loadExistingDocumentUpdateRows(input: {
  readonly documentId: string;
  readonly executor: DatabaseTransaction;
  readonly updateIds: readonly string[];
}) {
  const existingRows = await input.executor
    .select({
      documentId: documentUpdates.documentId,
      encryptedData: documentUpdates.encryptedData,
      id: documentUpdates.id,
      partialEndVersionVector: documentUpdates.partialEndVersionVector,
      partialStartVersionVector: documentUpdates.partialStartVersionVector,
      plaintextHash: documentUpdates.plaintextHash,
    })
    .from(documentUpdates)
    .where(inArray(documentUpdates.id, input.updateIds));

  for (const row of existingRows) {
    if (row.documentId !== input.documentId) {
      throw documentUpdateIdConflict();
    }
  }

  return existingRows;
}

/**
 * An inline rekey and its document updates commit atomically. If any update id
 * from a retried rekey-bearing request is already present, the earlier
 * transaction committed and only its response was lost. Reject before applying
 * the newly materialized rekey so the client can recover the accepted updates
 * with a read-only pass against the committed projection.
 */
export async function assertInlineRekeyUpdatesAreNew(input: {
  readonly documentId: string;
  readonly executor: DatabaseTransaction;
  readonly request: DocumentSyncRequest;
}): Promise<void> {
  if (
    (input.request.containerRekeys?.length ?? 0) === 0 ||
    input.request.outgoingUpdates.length === 0
  ) {
    return;
  }
  const outgoingUpdates = uniqueOutgoingUpdates(input.request.outgoingUpdates);
  const existingRows = await loadExistingDocumentUpdateRows({
    documentId: input.documentId,
    executor: input.executor,
    updateIds: uniqueSortedStrings(outgoingUpdates.map(({ id }) => id)),
  });
  if (existingRows.length > 0) {
    throw documentUpdateIdConflict();
  }
}

/**
 * An update the insert skipped was committed by a concurrent request after our
 * existence read. Acknowledging it is only sound when the committed bytes are
 * OUR bytes (the race was an idempotent duplicate); anything else is a genuine
 * id collision and must surface as the coded recoverable conflict. The
 * write-header equality gate that ran first already pins this in practice —
 * identical headers bind identical payloads — so this is the belt to that
 * suspender.
 */
async function assertConcurrentlyCommittedUpdatesMatch(input: {
  readonly documentId: string;
  readonly executor: DatabaseTransaction;
  readonly insertedUpdateIds: ReadonlySet<string>;
  readonly updates: readonly DocumentOutgoingUpdate[];
}): Promise<void> {
  const skippedUpdates = input.updates.filter(
    (update) => !input.insertedUpdateIds.has(update.id),
  );
  if (skippedUpdates.length === 0) {
    return;
  }

  const committedRows = await loadExistingDocumentUpdateRows({
    documentId: input.documentId,
    executor: input.executor,
    updateIds: uniqueSortedStrings(skippedUpdates.map((update) => update.id)),
  });
  const committedRowsById = new Map(committedRows.map((row) => [row.id, row]));
  for (const update of skippedUpdates) {
    const committedRow = committedRowsById.get(update.id);
    if (!storedDocumentUpdateMatchesOutgoingContent(committedRow, update)) {
      throw documentUpdateIdConflict();
    }
  }
}

interface AppendDocumentUpdatesResult {
  readonly acceptedOutgoingUpdateIds: string[];
  readonly insertedUpdateIds: ReadonlySet<string>;
}

async function verifyAndCollectNewOutgoingUpdates(input: {
  readonly acceptedHeaderHashes: Map<
    string,
    { header: WriteHeader; headerHash: string }
  >;
  readonly acceptedUpdateIds: Set<string>;
  readonly appendInput: AppendDocumentUpdatesInput;
  readonly existingRowsById: ReadonlyMap<
    string,
    Awaited<ReturnType<typeof loadExistingDocumentUpdateRows>>[number]
  >;
  readonly outgoingUpdates: readonly DocumentOutgoingUpdate[];
}): Promise<DocumentOutgoingUpdate[]> {
  const { appendInput } = input;
  const newUpdates: DocumentOutgoingUpdate[] = [];
  if (!appendInput.writeAuthorization) {
    throw new DocumentMutationError(
      "Document write authorization proof is required",
      400,
    );
  }

  for (const update of input.outgoingUpdates) {
    const acceptedHeaderHash = input.acceptedHeaderHashes.get(
      update.id,
    )?.headerHash;
    if (input.acceptedUpdateIds.has(update.id)) {
      await assertRetryUpdateMatchesAcceptedContent({
        acceptedHeaderHash,
        documentId: appendInput.documentId,
        existingRow: input.existingRowsById.get(update.id),
        update,
      });
      continue;
    }

    const verifiedHeader = await verifyOutgoingWriteHeader({
      documentId: appendInput.documentId,
      expectedLinkSetManifestHash:
        appendInput.request.expectedLinkSetManifestHash,
      expectedTargetHash: appendInput.request.expectedTargetHash,
      organizationId: appendInput.organizationId,
      requestContentKeyEpoch: appendInput.request.contentKeyEpoch,
      signingPublicKey: appendInput.signingPublicKey,
      update,
      userId: appendInput.userId,
      writeAuthorization: appendInput.writeAuthorization,
    });
    await storeDocumentContentWriteHeader(
      {
        authorizationTargets:
          appendInput.writeAuthorization.documentKekTargets.targets,
        documentId: appendInput.documentId,
        header: verifiedHeader.header,
        headerHash: verifiedHeader.headerHash,
        updateId: update.id,
      },
      appendInput.executor,
    );

    input.acceptedUpdateIds.add(update.id);
    input.acceptedHeaderHashes.set(update.id, {
      header: verifiedHeader.header,
      headerHash: verifiedHeader.headerHash,
    });
    newUpdates.push(update);
  }

  return newUpdates;
}

export async function appendDocumentUpdates(
  input: AppendDocumentUpdatesInput,
): Promise<AppendDocumentUpdatesResult> {
  if (input.request.outgoingUpdates.length === 0) {
    return {
      acceptedOutgoingUpdateIds: [],
      insertedUpdateIds: new Set(),
    };
  }

  const outgoingUpdates = uniqueOutgoingUpdates(input.request.outgoingUpdates);
  const updateIds = uniqueSortedStrings(
    outgoingUpdates.map((update) => update.id),
  );
  const existingRows = await loadExistingDocumentUpdateRows({
    documentId: input.documentId,
    executor: input.executor,
    updateIds,
  });
  const existingRowsById = new Map(existingRows.map((row) => [row.id, row]));
  const acceptedUpdateIds = new Set(existingRowsById.keys());
  const acceptedHeaderHashes = await listDocumentContentWriteHeaders(
    [...acceptedUpdateIds],
    input.executor,
  );
  const newUpdates = await verifyAndCollectNewOutgoingUpdates({
    acceptedHeaderHashes,
    acceptedUpdateIds,
    appendInput: input,
    existingRowsById,
    outgoingUpdates,
  });

  const insertedUpdateIds = await insertNewDocumentUpdates({
    accessEpoch: input.accessEpoch,
    documentId: input.documentId,
    executor: input.executor,
    fingerprint: input.fingerprint,
    updates: newUpdates,
  });
  await assertConcurrentlyCommittedUpdatesMatch({
    documentId: input.documentId,
    executor: input.executor,
    insertedUpdateIds,
    updates: newUpdates,
  });
  await appendAuditEntriesForNewDocumentUpdates({
    accessEpoch: input.accessEpoch,
    accessManifestHash: input.accessManifestHash,
    accessStateHash: input.accessStateHash,
    documentId: input.documentId,
    executor: input.executor,
    fingerprint: input.fingerprint,
    updates: newUpdates.filter((update) => insertedUpdateIds.has(update.id)),
    userId: input.userId,
  });

  return {
    acceptedOutgoingUpdateIds: acceptedOutgoingUpdateIds(
      outgoingUpdates,
      acceptedUpdateIds,
    ),
    insertedUpdateIds,
  };
}
