// Committing a stage inserts its update rows with one
// `INSERT ... SELECT ... ORDER BY segment_index`. Readers page a baseline by
// `sequence`, so the claim that needs a database to hold is that the
// identity column takes its values in that order, whatever order the staged
// rows sit in, and that the statement trigger counts the rows.
//
// This file runs on the memory database with every other suite, and again
// in the Postgres concurrency lane (`testPostgresConcurrency.sh`), where the
// claim is about Postgres itself. It keeps the plain `.test.ts` name for
// that reason: a `.pg.test.ts` file is one whose tests run only there.
import { expect, test } from "bun:test";
import { db, getDefaultApiDatabaseKind } from "@tearleads/api-shared/postgres";
import {
  documentBaselineSegmentSpans,
  documentBaselineSegments,
  documentBaselineStages,
  documentContentWriteHeaders,
  documentPeerOwners,
  documents,
  documentUpdateSpans,
  documentUpdates,
} from "@tearleads/api-shared/schema";
import type { WriteHeader } from "@tearleads/crypto";
import type { DocumentOutgoingUpdate } from "@tearleads/validators/request";
import {
  DOCUMENT_BASELINE_STAGE_ERROR_CODES,
  DOCUMENT_SYNC_ERROR_CODES,
} from "@tearleads/validators/response";
import { asc, eq, type SQL, sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  holdPostgresLock,
  waitForPostgresLockWait,
} from "../../../../test/helpers/postgresConcurrency";
import { writeHeaderAuthorizationHash } from "../../../documents/writeHeaderAuthorizationHash";
import { DocumentMutationError } from "./errors";
import {
  assertStagedBaselinePromotable,
  promoteStagedBaselineSegments,
} from "./stagedBaselinePromotion";

const SEGMENTS = 200;
const COMMITMENT = "c".repeat(64);

function header(updateId: string, organizationId: string): WriteHeader {
  // Only what a commit reads from a stored header; nothing here verifies one.
  return {
    accessManifestHash: "a".repeat(64),
    contentKeyEpoch: 4,
    contentRecordId: updateId,
    dependencyManifestHashes: [],
    encryptionSuite: "suite",
    nonceDomainHash: `nonce-${updateId}`,
    objectId: "object",
    objectKind: "document",
    organizationId,
    targetHash: "b".repeat(64),
    version: 1,
    writerKeyFingerprint: "f".repeat(64),
    writerUserId: "writer",
  } as unknown as WriteHeader;
}

/** A stage of `SEGMENTS` segments, each one op of its own peer. */
async function stagedGroup(
  input: {
    /** The hash a staged row carries, when not the final segment's. */
    readonly authorizationHash?: (index: number) => string | undefined;
  } = {},
) {
  const documentId = crypto.randomUUID();
  const baselineId = crypto.randomUUID();
  const organizationId = crypto.randomUUID();
  const ownerUserId = crypto.randomUUID();
  await db
    .insert(documents)
    .values({ createdByFingerprint: "promotion-test", id: documentId });
  const [stage] = await db
    .insert(documentBaselineStages)
    .values({
      contentKeyCommitment: COMMITMENT,
      contentKeyEpoch: 4,
      documentId,
      expiresAt: new Date(Date.now() + 60_000),
      id: baselineId,
      nextSegmentIndex: SEGMENTS,
      organizationId,
      ownerUserId,
      segmentsDigest: "0".repeat(64),
    })
    .returning();
  if (!stage) throw new Error("Expected a stage");
  const finalHeader = header(crypto.randomUUID(), organizationId);
  const authorizationHash = writeHeaderAuthorizationHash(finalHeader);
  const ids = Array.from({ length: SEGMENTS }, () => crypto.randomUUID());
  // Stored last index first, so the table's own order is the reverse of
  // the order the commit must insert in.
  const reversed = ids
    .map((updateId, index) => ({ index, updateId }))
    .reverse();
  await db.insert(documentBaselineSegments).values(
    reversed.map(({ index, updateId }) => ({
      authorizationHash: input.authorizationHash?.(index) ?? authorizationHash,
      baselineId,
      byteLength: 9,
      contentRecordId: updateId,
      dependencyVersionVector: "dependency",
      documentId,
      encryptedData: `payload-${index}`,
      header: header(updateId, organizationId),
      headerHash: `header-${updateId}`,
      nonceDomainHash: `nonce-${updateId}`,
      partialEndVersionVector: "end",
      partialStartVersionVector: "start",
      plaintextHash: "plaintext",
      segmentIndex: index,
      updateId,
    })),
  );
  await db.insert(documentBaselineSegmentSpans).values(
    reversed.map(({ index, updateId }) => ({
      baselineId,
      documentId,
      endCounter: 1,
      peerId: String(1000 + index),
      startCounter: 0,
      updateId,
    })),
  );
  // The raw statements a commit ran, as text: every aggregate over the
  // stage's spans is one of them.
  const statements: string[] = [];
  const dialect = new PgDialect();
  const promote = () =>
    db.transaction(async (transaction) => {
      const executor = new Proxy(transaction, {
        get(target, key) {
          if (key !== "execute") return Reflect.get(target, key, target);
          return (statement: SQL) => {
            statements.push(dialect.sqlToQuery(statement).sql);
            return target.execute(statement);
          };
        },
      });
      // Read the staged rows as the table holds them, not through the index
      // on their place: with an index scan the rows arrive in segment order
      // whether or not the statement asks for it.
      await executor.execute(sql`set local enable_indexscan = off`);
      await executor.execute(sql`set local enable_bitmapscan = off`);
      const promotion = {
        accessEpoch: 7,
        authorizationTargets: [],
        commit: {
          final: { id: finalHeader.contentRecordId } as DocumentOutgoingUpdate,
          finalHistory: { dependencies: [], spans: [] },
          stage,
        },
        contentKeyCommitment: COMMITMENT,
        documentId,
        executor,
        finalHeader,
        fingerprint: "writer-fingerprint",
        userId: ownerUserId,
      };
      // As a commit runs them: every check that can refuse, then the writes.
      await assertStagedBaselinePromotable(promotion);
      await promoteStagedBaselineSegments(promotion);
    });
  return { baselineId, documentId, ids, ownerUserId, promote, statements };
}

function committedRows(documentId: string) {
  return db
    .select({
      encryptedData: documentUpdates.encryptedData,
      id: documentUpdates.id,
      index: documentUpdates.baselineSegmentIndex,
      sequence: documentUpdates.sequence,
    })
    .from(documentUpdates)
    .where(eq(documentUpdates.documentId, documentId))
    .orderBy(asc(documentUpdates.sequence));
}

test("a stage's update rows take their sequences in segment order, and the insert trigger counts them", async () => {
  const { baselineId, documentId, ids, ownerUserId, promote } =
    await stagedGroup();
  await promote();

  const rows = await committedRows(documentId);
  // Ordered by sequence, the rows are the segments in index order.
  expect(rows.map((row) => row.id)).toEqual(ids);
  expect(rows.map((row) => row.index)).toEqual(ids.map((_, index) => index));
  expect(new Set(rows.map((row) => row.sequence)).size).toBe(SEGMENTS);
  // By reference: no row holds a payload, and every staged row is kept.
  expect(rows.every((row) => row.encryptedData === null)).toBe(true);
  const kept = await db
    .select({ updateId: documentBaselineSegments.updateId })
    .from(documentBaselineSegments)
    .where(eq(documentBaselineSegments.documentId, documentId));
  expect(kept).toHaveLength(SEGMENTS);

  const [document] = await db
    .select({ updateCount: documents.updateCount })
    .from(documents)
    .where(eq(documents.id, documentId));
  expect(document?.updateCount).toBe(SEGMENTS);

  // Headers and spans follow the rows; the stage and its span rows are gone.
  const count = async (
    table:
      | typeof documentContentWriteHeaders
      | typeof documentUpdateSpans
      | typeof documentBaselineSegmentSpans
      | typeof documentBaselineStages,
  ) =>
    (
      await db
        .select({ documentId: table.documentId })
        .from(table)
        .where(eq(table.documentId, documentId))
    ).length;
  expect(await count(documentContentWriteHeaders)).toBe(SEGMENTS);
  expect(await count(documentUpdateSpans)).toBe(SEGMENTS);
  expect(await count(documentBaselineSegmentSpans)).toBe(0);
  expect(await count(documentBaselineStages)).toBe(0);
  const owners = await db
    .select({ ownerUserId: documentPeerOwners.ownerUserId })
    .from(documentPeerOwners)
    .where(eq(documentPeerOwners.documentId, documentId));
  expect(owners).toHaveLength(SEGMENTS);
  expect(new Set(owners.map((owner) => owner.ownerUserId))).toEqual(
    new Set([ownerUserId]),
  );
  expect(new Set(kept.map((row) => row.updateId))).toEqual(
    new Set<string>(ids),
  );
  expect(baselineId).not.toBe(documentId);
});

test("one staged header signed for another manifest refuses the whole stage", async () => {
  const { documentId, promote } = await stagedGroup({
    authorizationHash: (index) => (index === 137 ? "stale" : undefined),
  });
  // One row of two hundred: the check reads the stage as a set.
  const refusal = await promote().then(
    () => null,
    (error: unknown) => error,
  );
  expect(refusal).toBeInstanceOf(DocumentMutationError);
  expect(refusal).toMatchObject({
    details: {
      baselineStageCode: DOCUMENT_BASELINE_STAGE_ERROR_CODES.headersStale,
    },
    status: 409,
  });
  expect(await committedRows(documentId)).toEqual([]);
});

/** Another document's update under `id`, as any writer may commit one. */
function foreignUpdate(id: string) {
  return {
    accessEpoch: 1,
    authorFingerprint: "another-writer",
    byteLength: 7,
    dependencyVersionVector: "dependency",
    documentId: crypto.randomUUID(),
    encryptedData: "payload",
    id,
    partialEndVersionVector: "end",
    partialStartVersionVector: "start",
    plaintextHash: "plaintext",
  };
}

const UPDATE_ID_CONFLICT = {
  code: DOCUMENT_SYNC_ERROR_CODES.updateIdConflict,
  message: "Document update id conflict",
  status: 409,
};

// A refused commit keeps its stage, so its writer can send it again: what a
// refusal reads is what a writer can make the server read again. A stage
// that extends another user's peer is refused from that user's peers, by
// index, and no statement aggregates the stage's spans or writes a row.
test("a stage that extends another user's peer is refused without reading its spans whole", async () => {
  const { documentId, promote, statements } = await stagedGroup();
  const ownedBy = (ownerUserId: string, peerId: string) =>
    db.insert(documentPeerOwners).values({ documentId, ownerUserId, peerId });
  await ownedBy(crypto.randomUUID(), "1061");
  // A peer another user owns that the stage does not carry refuses nothing.
  await ownedBy(crypto.randomUUID(), "909090");
  const refusal = await promote().then(
    () => null,
    (error: unknown) => error,
  );
  expect(refusal).toBeInstanceOf(DocumentMutationError);
  expect(refusal).toMatchObject({
    code: DOCUMENT_SYNC_ERROR_CODES.peerOwned,
    details: { peerFrontiers: [{ committedEndCounter: 0, peerId: "1061" }] },
    status: 409,
  });
  expect(statements.length).toBeGreaterThan(0);
  expect(
    statements.filter((text) => /group by|insert into/iu.test(text)),
  ).toEqual([]);
  expect(await committedRows(documentId)).toEqual([]);

  // The peer's committed frontier reaches what the stage carries of it: the
  // stage re-asserts it, which any writer may, and commits.
  await db
    .delete(documentPeerOwners)
    .where(eq(documentPeerOwners.documentId, documentId));
  statements.length = 0;
  await promote();
  expect(statements.some((text) => /group by/iu.test(text))).toBe(true);
  expect(await committedRows(documentId)).toHaveLength(SEGMENTS);
});

// An update id names one update everywhere, and the document head lock a
// commit holds keeps out only its own document's writers.
test("an update that took a staged segment's id refuses the stage", async () => {
  const { documentId, ids, promote } = await stagedGroup();
  await db.insert(documentUpdates).values(foreignUpdate(ids[61] ?? ""));
  const refusal = await promote().then(
    () => null,
    (error: unknown) => error,
  );
  expect(refusal).toBeInstanceOf(DocumentMutationError);
  expect(refusal).toMatchObject(UPDATE_ID_CONFLICT);
  expect(await committedRows(documentId)).toEqual([]);
});

// The same id committed by another document's writer after the commit read
// that it was free: the insert meets the unique index, and that is the same
// conflict. Only a database with several connections can show it.
test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
  "an update that takes a staged segment's id while the stage commits refuses it the same way",
  async () => {
    const { documentId, ids, promote } = await stagedGroup();
    const other = await holdPostgresLock(async (tx) => {
      await tx.insert(documentUpdates).values(foreignUpdate(ids[61] ?? ""));
    });
    let promoting: Promise<unknown> | undefined;
    try {
      promoting = promote().then(
        () => null,
        (error: unknown) => error,
      );
      // The commit's read found the id free; its insert waits for the
      // other writer's uncommitted row.
      await waitForPostgresLockWait({
        blockerPid: other.backendPid,
        queryFragment: "insert into",
      });
    } finally {
      // The other writer commits.
      await other.release();
    }
    const refusal = await promoting;
    expect(refusal).toBeInstanceOf(DocumentMutationError);
    expect(refusal).toMatchObject(UPDATE_ID_CONFLICT);
    expect(await committedRows(documentId)).toEqual([]);
  },
  60_000,
);
