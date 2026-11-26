// What a member can make the server hold uncommitted is bounded: bytes and
// span rows per stage, stages per user, and how long an expired stage waits
// for the sweep.
import { expect, spyOn, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { documentBaselineStages } from "@tearleads/api-shared/schema";
import type { WriteHeader } from "@tearleads/crypto";
import { DOCUMENT_BASELINE_STAGE_ERROR_CODES as STAGE } from "@tearleads/validators/response";
import {
  MAX_DOCUMENT_BASELINE_STAGE_BYTES,
  MAX_DOCUMENT_BASELINE_STAGE_SPANS,
  MAX_OPEN_DOCUMENT_BASELINE_STAGES_PER_USER,
} from "@tearleads/validators/util";
import { and, eq, inArray, lte } from "drizzle-orm";
import {
  peerRanges,
  signerFor,
} from "../../../test/helpers/baselineGroupRefusals";
import { documentWithHistory } from "../../../test/helpers/baselineGroupRouteKit";
import {
  abandonStage,
  openStage,
  putSegment,
  setStageExpiry,
  stagedRows,
} from "../../../test/helpers/baselineStageKit";
import { createDocument } from "../../../test/helpers/keyingWriterProjectionKit";
import { runDocumentBaselineStageMaintenance } from "../../services/documents/documentBaselineStages";
import { getDefaultApiServiceRuntime } from "../../services/runtime";
import { cleanupExpiredDocumentBaselineStages } from "../../workflows/documents/baselineStages";
import { assertSegmentFitsStage } from "../../workflows/documents/baselineStages/stagedSegmentRows";

test("the published stage bounds", () => {
  expect(MAX_DOCUMENT_BASELINE_STAGE_BYTES).toBe(1024 ** 3);
  expect(MAX_DOCUMENT_BASELINE_STAGE_SPANS).toBe(2 ** 20);
  expect(MAX_OPEN_DOCUMENT_BASELINE_STAGES_PER_USER).toBe(4);
});

test("a stage takes no segment past its byte cap or its span cap", async () => {
  const history = await documentWithHistory();
  const { created, frontier, owner, root } = history;
  const [first] = await signerFor(history, {
    accessManifestHash: created.manifestHash,
    contentKeyEpoch: created.contentKeyEpoch,
    dependencyManifestHashes: [root.bundle.manifestHash],
    targetHash: created.targetHash,
  })({ ranges: peerRanges(frontier) });
  if (!first?.baselineId) throw new Error("Expected a segment");
  const baselineId = first.baselineId;
  expect(
    (
      await openStage(owner, created.id, {
        baselineId,
        contentKeyEpoch: created.contentKeyEpoch,
      })
    ).status,
  ).toBe(200);
  const hold = (values: { stagedBytes?: number; stagedSpans?: number }) =>
    db
      .update(documentBaselineStages)
      .set(values)
      .where(eq(documentBaselineStages.id, baselineId));

  // The stage already stores all but a few bytes of what one may: the
  // segment's own bytes, its vectors and header among them, do not fit.
  await hold({ stagedBytes: MAX_DOCUMENT_BASELINE_STAGE_BYTES - 16 });
  const tooManyBytes = await putSegment(owner, created.id, first);
  expect(tooManyBytes.status).toBe(409);
  expect(await tooManyBytes.json()).toEqual({
    code: STAGE.tooLarge,
    error: "Document baseline stage would exceed its byte cap",
  });
  // The segment carries one span, and the stage has room for none.
  await hold({
    stagedBytes: 0,
    stagedSpans: MAX_DOCUMENT_BASELINE_STAGE_SPANS,
  });
  const tooManySpans = await putSegment(owner, created.id, first);
  expect(tooManySpans.status).toBe(409);
  expect(await tooManySpans.json()).toEqual({
    code: STAGE.tooLarge,
    error: "Document baseline stage would exceed its span cap",
  });
  expect(await stagedRows(created.id)).toMatchObject({
    segments: [],
    spans: [],
    stages: [{ id: baselineId, nextSegmentIndex: 0 }],
  });

  // With room for exactly one span, it is staged and counted.
  await hold({ stagedSpans: MAX_DOCUMENT_BASELINE_STAGE_SPANS - 1 });
  expect((await putSegment(owner, created.id, first)).status).toBe(200);
  const [row] = await db
    .select()
    .from(documentBaselineStages)
    .where(eq(documentBaselineStages.id, baselineId));
  expect(row?.stagedSpans).toBe(MAX_DOCUMENT_BASELINE_STAGE_SPANS);
  expect(row?.stagedBytes).toBeGreaterThan(first.encryptedData.length);
});

// A segment's cost is everything its staged row keeps, so one of small
// ciphertext and wide vectors counts for what it stores.
test("a segment is weighed by its ciphertext, vectors, hash and header", () => {
  const header = { signed: "h".repeat(40) } as unknown as WriteHeader;
  const size = assertSegmentFitsStage(
    { stagedBytes: 0, stagedSpans: 0 },
    {
      header,
      history: {
        dependencies: [],
        spans: [
          { endCounter: 1, peerId: "1", startCounter: 0 },
          { endCounter: 1, peerId: "2", startCounter: 0 },
        ],
      },
      segment: {
        dependencyVersionVector: "d".repeat(7),
        encryptedData: "é".repeat(5),
        id: "id",
        partialEndVersionVector: "e".repeat(11),
        partialStartVersionVector: "s".repeat(13),
        plaintextHash: "p".repeat(17),
        writeHeader: {},
      },
    },
  );
  expect(size).toEqual({
    bytes: 10 + 7 + 11 + 13 + 17 + JSON.stringify(header).length,
    spans: 2,
  });
});

test("a user holds a bounded number of open stages across documents", async () => {
  const { created, owner, root } = await documentWithHistory();
  const documents = [created];
  while (documents.length <= MAX_OPEN_DOCUMENT_BASELINE_STAGES_PER_USER) {
    documents.push(await createDocument({ owner, root }));
  }
  const open = (document: (typeof documents)[number], baselineId: string) =>
    openStage(owner, document.id, {
      baselineId,
      contentKeyEpoch: document.contentKeyEpoch,
    });
  const [extra, ...held] = documents;
  if (!extra) throw new Error("Expected a document");
  const stageIds = held.map(() => crypto.randomUUID());
  for (const [index, document] of held.entries()) {
    expect((await open(document, stageIds[index] ?? "")).status).toBe(200);
  }

  // One more, on another document, is refused, and nothing is stored for it.
  const refused = await open(extra, crypto.randomUUID());
  expect(refused.status).toBe(409);
  expect(await refused.json()).toEqual({
    code: STAGE.limitReached,
    error: "Too many open document baseline stages",
  });
  expect((await stagedRows(extra.id)).stages).toEqual([]);

  // Opening again where the user holds a stage replaces it and counts once.
  const [firstHeld] = held;
  if (!firstHeld) throw new Error("Expected a held stage");
  expect((await open(firstHeld, stageIds[0] ?? "")).status).toBe(200);
  expect((await open(firstHeld, crypto.randomUUID())).status).toBe(200);
  expect((await open(extra, crypto.randomUUID())).status).toBe(409);

  // An expired stage is dead: it does not count, and the open that finds
  // it deletes it with what it staged.
  const expired = held[1];
  if (!expired) throw new Error("Expected a second held stage");
  await setStageExpiry(expired.id, stageIds[1] ?? "", new Date(0));
  expect((await open(extra, crypto.randomUUID())).status).toBe(200);
  expect((await stagedRows(expired.id)).stages).toEqual([]);
  // Abandoning one makes room too.
  const another = await createDocument({ owner, root });
  expect((await open(another, crypto.randomUUID())).status).toBe(409);
  expect(
    (await abandonStage(owner, held[2]?.id ?? "", stageIds[2] ?? "")).status,
  ).toBe(200);
  expect((await open(another, crypto.randomUUID())).status).toBe(200);
});

/** Stores `count` expired stages of documents nobody else touches. */
async function expiredStages(count: number): Promise<string[]> {
  const ids = Array.from({ length: count }, () => crypto.randomUUID());
  await db.insert(documentBaselineStages).values(
    ids.map((id, index) => ({
      contentKeyCommitment: "0".repeat(64),
      contentKeyEpoch: 1,
      documentId: crypto.randomUUID(),
      expiresAt: new Date(1000 + index),
      id,
      organizationId: crypto.randomUUID(),
      ownerUserId: crypto.randomUUID(),
      segmentsDigest: "0".repeat(64),
    })),
  );
  return ids;
}

async function stored(ids: readonly string[]): Promise<number> {
  return (
    await db
      .select({ id: documentBaselineStages.id })
      .from(documentBaselineStages)
      .where(inArray(documentBaselineStages.id, [...ids]))
  ).length;
}

// These stages expired at the start of time, so they sort ahead of any other
// test's and a run bounded by count reads them first.
test("the sweep drains every expired stage, and says what a budget made it leave", async () => {
  const now = new Date(10_000);
  const ids = await expiredStages(250);
  const expiredBefore = (
    await db
      .select({ id: documentBaselineStages.id })
      .from(documentBaselineStages)
      .where(and(lte(documentBaselineStages.expiresAt, now)))
  ).length;
  expect(expiredBefore).toBe(250);

  // A run stopped by its count budget leaves the rest and reports them.
  const bounded = await cleanupExpiredDocumentBaselineStages(db, {
    maxStages: 120,
    now,
  });
  expect(bounded).toMatchObject({
    deletedStages: 120,
    failures: [],
    remainingStages: 130,
    scannedStages: 120,
  });
  expect(await stored(ids)).toBe(130);
  // A run whose time is already up deletes nothing.
  let tick = 0;
  const outOfTime = await cleanupExpiredDocumentBaselineStages(db, {
    budgetMs: 5,
    clock: () => {
      tick += 10;
      return tick;
    },
    now,
  });
  expect(outOfTime).toMatchObject({ deletedStages: 0, remainingStages: 130 });

  // The scheduled run says so in its summary and its log, then drains: more
  // than one batch, in one run.
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  try {
    const runtime = getDefaultApiServiceRuntime();
    expect(
      await runDocumentBaselineStageMaintenance(runtime, {
        maxStages: 10,
        now,
      }),
    ).toEqual({ deleted: 10, failed: 0, remaining: 120, scanned: 10 });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("left 120 stage(s)");
    expect(await runDocumentBaselineStageMaintenance(runtime, { now })).toEqual(
      { deleted: 120, failed: 0, remaining: 0, scanned: 120 },
    );
    expect(warn).toHaveBeenCalledTimes(1);
  } finally {
    warn.mockRestore();
  }
  expect(await stored(ids)).toBe(0);
});
