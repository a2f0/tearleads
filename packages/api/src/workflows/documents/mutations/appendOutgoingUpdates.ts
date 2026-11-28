import { Buffer } from "node:buffer";
import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import {
  documentBaselineSegments,
  documentUpdates,
} from "@tearleads/api-shared/schema";
import type { WriteHeader } from "@tearleads/crypto";
import type { DocumentOutgoingUpdate } from "@tearleads/validators/request";
import { type AnyColumn, eq, inArray, sql } from "drizzle-orm";
import { listDocumentContentWriteHeaders } from "../../../access/read/documentContentKeyStore";
import { storeDocumentContentWriteHeader } from "../../../access/write/documentContentKeyStore";
import { claimDocumentPeers } from "../../../documents/documentPeerOwners";
import { storedDocumentUpdatePayload } from "../../../documents/documentUpdatePageRows";
import { insertDocumentUpdateSpans } from "../../../documents/documentUpdateSpans";
import { uniqueSortedStrings } from "../../../utils/array";
import {
  DocumentMutationError,
  documentDependencyUncommitted,
  documentPeerOwned,
  documentUpdateIdConflict,
  documentUpdatesStoredOutOfOrder,
} from "./errors";
import {
  assertRetryUpdateMatchesAcceptedContent,
  storedDocumentUpdateMatchesOutgoingContent,
  uniqueOutgoingUpdates,
  verifyOutgoingWriteHeader,
} from "./outgoingUpdateVerification";
import {
  assertStagedBaselinePromotable,
  type PromoteStagedBaselineSegmentsInput,
  promoteStagedBaselineSegments,
} from "./stagedBaselinePromotion";
import type { AppendDocumentUpdatesInput } from "./types";

/**
 * Dedup, idempotent-retry matching, and insertion of a sync request's outgoing
 * updates; a rotation baseline's segments are marked on their own update
 * rows. Split from syncDocument.ts, which keeps the transaction
 * orchestration; per-update verification lives in outgoingUpdateVerification.
 * One insert takes the request's new updates in request order, so their
 * sequences rise in that order and a baseline's segments are served as sent.
 */
function documentUpdateByteLength(update: DocumentOutgoingUpdate): number {
  return Buffer.byteLength(update.encryptedData, "utf8");
}

/**
 * A rotation baseline's segments carry their group fields on their update
 * rows, so the redirect, sync response, and edit attribution find the group
 * without a second insert. Only updates this transaction inserts are
 * written, so a retried segment never changes a committed row.
 */
function baselineSegmentColumns(update: DocumentOutgoingUpdate) {
  return {
    baselineCoversThroughUpdateId: update.coversThroughUpdateId ?? null,
    baselineId: update.baselineId ?? null,
    baselineSegmentCount: update.baselineSegmentCount ?? null,
    baselineSegmentIndex: update.baselineSegmentIndex ?? null,
    baselineSegmentsDigest: update.baselineSegmentsDigest ?? null,
  };
}

function acceptedOutgoingUpdateIds(
  updates: readonly DocumentOutgoingUpdate[],
  acceptedUpdateIds: ReadonlySet<string>,
): string[] {
  return updates
    .filter((update) => acceptedUpdateIds.has(update.id))
    .map((update) => update.id);
}

/**
 * A request's updates are committed in request order: a pull serves by
 * `sequence`, a rotation baseline's segments are read back as a group in it,
 * and a redirect starts at the group's first. One multi-row insert assigns
 * the identity column in row order in practice, which Postgres does not
 * promise, so the order is checked from the rows it returned. A request
 * whose rows came back out of order is refused as a coded conflict
 * (`documentUpdatesStoredOutOfOrder`), and its transaction rolls back.
 */
export function assertStoredInRequestOrder(
  updates: readonly Pick<DocumentOutgoingUpdate, "id">[],
  insertedRows: readonly { readonly id: string; readonly sequence: number }[],
): void {
  const sequenceById = new Map(
    insertedRows.map((row) => [row.id, row.sequence]),
  );
  let previous: number | null = null;
  for (const { id } of updates) {
    const sequence = sequenceById.get(id);
    if (sequence === undefined) continue;
    if (previous !== null && sequence <= previous) {
      throw documentUpdatesStoredOutOfOrder();
    }
    previous = sequence;
  }
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
        dependencyVersionVector: update.dependencyVersionVector,
        plaintextHash: update.plaintextHash,
        ...baselineSegmentColumns(update),
      })),
    )
    .onConflictDoNothing({ target: documentUpdates.id })
    .returning({ id: documentUpdates.id, sequence: documentUpdates.sequence });
  assertStoredInRequestOrder(input.updates, insertedRows);
  const insertedUpdateIds = new Set(insertedRows.map((row) => row.id));
  await insertDocumentUpdateSpans(input.executor, {
    documentId: input.documentId,
    updates: input.updates.filter((update) => insertedUpdateIds.has(update.id)),
  });

  return insertedUpdateIds;
}

function contentSha256(column: AnyColumn) {
  return sql<string>`encode(sha256(convert_to(${column}, 'UTF8')), 'hex')`;
}

/**
 * A request names ids, not sizes: loading the named rows' content would let
 * one sync pull every named update (each up to the request ceiling, from any
 * document) into the isolate before the document check below. Postgres
 * digests the content columns instead, and only the digests come back.
 */
async function loadExistingDocumentUpdateRows(input: {
  readonly documentId: string;
  readonly executor: DatabaseTransaction;
  readonly updateIds: readonly string[];
}) {
  const existingRows = await input.executor
    .select({
      dependencyVersionVectorSha256: contentSha256(
        documentUpdates.dependencyVersionVector,
      ),
      documentId: documentUpdates.documentId,
      encryptedDataSha256: sql<string>`encode(sha256(convert_to(${storedDocumentUpdatePayload}, 'UTF8')), 'hex')`,
      id: documentUpdates.id,
      partialEndVersionVectorSha256: contentSha256(
        documentUpdates.partialEndVersionVector,
      ),
      partialStartVersionVectorSha256: contentSha256(
        documentUpdates.partialStartVersionVector,
      ),
      plaintextHashSha256: contentSha256(documentUpdates.plaintextHash),
    })
    .from(documentUpdates)
    .leftJoin(
      documentBaselineSegments,
      eq(documentBaselineSegments.updateId, documentUpdates.id),
    )
    .where(inArray(documentUpdates.id, input.updateIds));

  for (const row of existingRows) {
    if (row.documentId !== input.documentId) {
      throw documentUpdateIdConflict();
    }
  }

  return existingRows;
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
    if (input.acceptedUpdateIds.has(update.id)) {
      await assertRetryUpdateMatchesAcceptedContent({
        acceptedHeader: input.acceptedHeaderHashes.get(update.id),
        documentId: appendInput.documentId,
        existingRow: input.existingRowsById.get(update.id),
        update,
      });
      continue;
    }

    const verifiedHeader = await verifyOutgoingWriteHeader({
      contentKeyCommitment: appendInput.contentKeyCommitment,
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

/**
 * A request that commits a staged baseline carries the group's final
 * segment, which the loop above has just verified in full. The staged
 * segments are committed before the request's own updates are inserted:
 * the final segment starts every peer where they end and depends on them,
 * and their rows must take the lower sequences, so a reader pages the group
 * in index order with nothing between.
 */
function stagedBaselinePromotion(input: {
  readonly acceptedHeaderHashes: ReadonlyMap<
    string,
    { readonly header: WriteHeader }
  >;
  readonly appendInput: AppendDocumentUpdatesInput;
  readonly newUpdates: readonly DocumentOutgoingUpdate[];
}): PromoteStagedBaselineSegmentsInput | null {
  const { appendInput } = input;
  const commit = appendInput.stagedBaseline;
  if (!commit) return null;
  const finalHeader = input.acceptedHeaderHashes.get(commit.final.id)?.header;
  if (
    !finalHeader ||
    !appendInput.writeAuthorization ||
    !input.newUpdates.some((update) => update.id === commit.final.id)
  ) {
    throw new DocumentMutationError(
      "Document rotation baseline was not inserted",
      409,
    );
  }
  return {
    accessEpoch: appendInput.accessEpoch,
    authorizationTargets:
      appendInput.writeAuthorization.documentKekTargets.targets,
    commit,
    contentKeyCommitment: appendInput.contentKeyCommitment,
    documentId: appendInput.documentId,
    executor: appendInput.executor,
    finalHeader,
    fingerprint: appendInput.fingerprint,
    userId: appendInput.userId,
  };
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
  // Everything that can refuse the request is asked before the stage is
  // promoted: whether the stage can commit, then whether the request's own
  // updates may follow it, judged against the frontier and the owners the
  // promotion will leave. A refused commit keeps its stage and can be sent
  // again, so it must not cost the promotion's writes each time.
  const staged = stagedBaselinePromotion({
    acceptedHeaderHashes,
    appendInput: input,
    newUpdates,
  });
  if (staged) await assertStagedBaselinePromotable(staged);
  // Retried ids already committed skip the ownership and dependency checks
  // as they skip the insert; the caller's document head lock spans the checks
  // and the insert.
  const refusal = await claimDocumentPeers(input.executor, {
    documentId: input.documentId,
    documentInsertedInTransaction: input.documentInsertedInTransaction,
    hasRestoredPeerOwners: input.hasRestoredPeerOwners,
    stagedBaselineId: staged?.commit.stage.id,
    updates: newUpdates,
    userId: input.userId,
  });
  if (refusal?.kind === "peer_owned") {
    throw documentPeerOwned(refusal.peerFrontiers);
  }
  if (refusal?.kind === "dependency_uncommitted") {
    throw documentDependencyUncommitted(refusal.peerFrontiers);
  }
  if (staged) await promoteStagedBaselineSegments(staged);

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

  return {
    acceptedOutgoingUpdateIds: acceptedOutgoingUpdateIds(
      outgoingUpdates,
      acceptedUpdateIds,
    ),
    insertedUpdateIds,
  };
}
