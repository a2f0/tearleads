// What a heal does when its staged rotation baseline is refused: each of the
// API's stage codes, the coverage refusal, a lost answer, and a restart.
import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  encodeVersionVector,
  historySegmentsImportInOrder,
  mergeVersionVectors,
  versionVectorsEqual,
} from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  DOCUMENT_SYNC_ERROR_CODES,
  DOCUMENT_BASELINE_STAGE_ERROR_CODES as STAGE,
} from "@tearleads/validators/response";
import {
  appendHistory,
  createLongHistoryDocument,
  createStagedHealHarness,
} from "../../../../test/helpers/workflows/stagedBaselineHeal";
import { ensureDocumentTables } from "../../../data/persistence/documents/records";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";

let execSql: ExecSql;
let closeExecSql: () => void;

beforeEach(async () => {
  ({ close: closeExecSql, execSql } = await createTestExecSql(
    "document-sync-staged-recovery",
  ));
  await ensureDocumentTables(execSql);
});

afterEach(() => closeExecSql());

type Harness = Awaited<ReturnType<typeof createStagedHealHarness>>;
type HistoryDocument = Awaited<ReturnType<typeof createLongHistoryDocument>>;

/** The last group the server committed, whole and at `document`'s version. */
function committedGroup(harness: Harness, document: HistoryDocument) {
  const group = harness.server.committed.at(-1) ?? [];
  expect(historySegmentsImportInOrder(group)).toBe(true);
  expect(
    versionVectorsEqual(
      mergeVersionVectors(
        group.map((segment) => segment.partialEndVersionVector),
      ),
      encodeVersionVector(document),
    ),
  ).toBe(true);
  return group;
}

function groupRefusal(baselineStageCode: (typeof STAGE)[keyof typeof STAGE]) {
  return {
    baselineStageCode,
    code: DOCUMENT_SYNC_ERROR_CODES.baselineGroupInvalid,
    message: `commit refused: ${baselineStageCode}`,
    status: 409,
  };
}

const staged = (calls: readonly string[]) =>
  calls.filter((call) => call.startsWith("stage:"));

test("a coverage refusal keeps the stage, and a longer history appends a tail", async () => {
  const harness = await createStagedHealHarness();
  const document = await createLongHistoryDocument("tail-append");
  harness.script.refuse = (_request, ordinal) =>
    ordinal === 1
      ? {
          code: DOCUMENT_SYNC_ERROR_CODES.checkpointCoverageConflict,
          message: "the baseline does not cover the committed frontier",
          status: 409,
        }
      : null;

  // The refusal is terminal for the pass, as it is for a baseline sent
  // whole: this device's history is what stopped short.
  expect(await harness.heal(document, execSql)).toBeNull();
  expect(harness.terminalFailures.map((failure) => failure.code)).toEqual([
    DOCUMENT_SYNC_ERROR_CODES.checkpointCoverageConflict,
  ]);
  const idsBefore = (
    harness.server.stage(harness.documentId)?.segments ?? []
  ).map((segment) => segment.id);
  const stagedBefore = idsBefore.length;
  expect(stagedBefore).toBeGreaterThan(64);
  const callsBefore = harness.server.calls.length;
  const firstRequest = harness.requests[0];

  // The device gains what was committed meanwhile and heals again.
  appendHistory(document, 6);
  const synced = await harness.heal(document, execSql);

  expect(synced?.acceptedRecoveryBaseline).toBe(true);
  const group = committedGroup(harness, document);
  // Nothing staged is sent again: the stage is read, then only the tail.
  const tail = harness.server.calls.slice(callsBefore);
  expect(tail[0]).toBe("get");
  expect(staged(tail)[0]).toBe(`stage:${stagedBefore}`);
  expect(tail).not.toContain("open");
  expect(group.slice(0, stagedBefore).map((segment) => segment.id)).toEqual(
    idsBefore,
  );
  // The same baseline and the same fresh key commit, with a new final.
  const secondRequest = harness.requests[1];
  expect(secondRequest?.baselineStageId).toBe(firstRequest?.baselineStageId);
  expect(secondRequest?.contentKeyBundle?.contentKeyCommitment).toBe(
    firstRequest?.contentKeyBundle?.contentKeyCommitment,
  );
  expect(secondRequest?.outgoingUpdates[0]?.id).not.toBe(
    firstRequest?.outgoingUpdates[0]?.id,
  );
  expect(group.length).toBeGreaterThan(stagedBefore + 1);
});

test("stale headers are signed again, one request a segment, and the commit retried", async () => {
  const harness = await createStagedHealHarness();
  const document = await createLongHistoryDocument("resign-headers");
  harness.script.refuse = (_request, ordinal) =>
    ordinal === 1 ? groupRefusal(STAGE.headersStale) : null;

  const synced = await harness.heal(document, execSql);

  expect(synced?.acceptedRecoveryBaseline).toBe(true);
  const group = committedGroup(harness, document);
  const stagedCount = group.length - 1;
  // Each segment was uploaded once; each header was then signed once more.
  expect(staged(harness.server.calls)).toHaveLength(stagedCount);
  expect(
    harness.server.calls.filter((call) => call.startsWith("resign:")),
  ).toEqual(group.slice(0, -1).map((_, index) => `resign:${index}`));
  expect(harness.requests).toHaveLength(2);
  expect(harness.terminalFailures).toEqual([]);
});

test.each([STAGE.notFound, STAGE.expired, STAGE.epochStale])(
  "a commit refused with %s starts the upload over",
  async (code) => {
    const harness = await createStagedHealHarness();
    const document = await createLongHistoryDocument(`start-over-${code}`);
    harness.script.refuse = (_request, ordinal) => {
      if (ordinal !== 1) return null;
      // The stage is gone for the first two; for the third it still stands.
      if (code !== STAGE.epochStale) harness.server.drop(harness.documentId);
      return groupRefusal(code);
    };

    const synced = await harness.heal(document, execSql);

    expect(synced?.acceptedRecoveryBaseline).toBe(true);
    const group = committedGroup(harness, document);
    expect(harness.requests).toHaveLength(2);
    const [first, second] = harness.requests;
    expect(second?.baselineStageId).not.toBe(first?.baselineStageId);
    expect(harness.server.calls.filter((call) => call === "open")).toHaveLength(
      2,
    );
    // Every segment was uploaded twice: nothing of the first stage was kept.
    expect(staged(harness.server.calls)).toHaveLength(2 * (group.length - 1));
    // A stage that still stood was given up before the new one opened.
    expect(harness.server.calls.includes("abandon")).toBe(
      code === STAGE.epochStale,
    );
  },
);

test("a stage that expires while it uploads is opened again within the pass", async () => {
  const harness = await createStagedHealHarness();
  const document = await createLongHistoryDocument("expires-mid-upload");
  harness.server.beforeNext("stage:5", () =>
    harness.server.expire(harness.documentId),
  );

  const synced = await harness.heal(document, execSql);

  expect(synced?.acceptedRecoveryBaseline).toBe(true);
  const group = committedGroup(harness, document);
  expect(harness.server.calls.slice(0, 8)).toEqual([
    "open",
    "stage:0",
    "stage:1",
    "stage:2",
    "stage:3",
    "stage:4",
    "stage:5",
    "open",
  ]);
  expect(harness.requests).toHaveLength(1);
  expect(group[0]?.baselineId).toBe(harness.requests[0]?.baselineStageId);
});

test("a stage lost twice in one pass ends the pass with a recorded failure", async () => {
  const harness = await createStagedHealHarness();
  const document = await createLongHistoryDocument("expires-twice");
  const expire = () => harness.server.expire(harness.documentId);
  harness.server.beforeNext("stage:2", () => {
    expire();
    harness.server.beforeNext("stage:1", expire);
  });

  expect(await harness.heal(document, execSql)).toBeNull();

  expect(harness.requests).toEqual([]);
  expect(harness.terminalFailures.map((failure) => failure.message)).toEqual([
    "Document rotation baseline lost its stage twice while uploading",
  ]);
});

test("an upload whose answer was lost resumes from what the stage holds", async () => {
  const harness = await createStagedHealHarness();
  const document = await createLongHistoryDocument("lost-answer");
  harness.server.loseNextAnswer("stage:3");

  expect(await harness.heal(document, execSql)).toBeNull();
  expect(harness.server.stage(harness.documentId)?.segments).toHaveLength(4);
  const callsBefore = harness.server.calls.length;

  const synced = await harness.heal(document, execSql);

  expect(synced?.acceptedRecoveryBaseline).toBe(true);
  committedGroup(harness, document);
  // Segment 3 reached the stage, so the upload goes on from segment 4.
  const resumed = harness.server.calls.slice(callsBefore);
  expect(resumed.slice(0, 2)).toEqual(["get", "stage:4"]);
  expect(resumed).not.toContain("open");
});

test("a segment refused out of order is answered by reading the stage", async () => {
  const harness = await createStagedHealHarness();
  const document = await createLongHistoryDocument("out-of-order");
  harness.server.refuseNext("stage:3", {
    code: STAGE.segmentOutOfOrder,
    nextSegmentIndex: 3,
    status: 409,
  });

  const synced = await harness.heal(document, execSql);

  expect(synced?.acceptedRecoveryBaseline).toBe(true);
  committedGroup(harness, document);
  expect(harness.server.calls.slice(0, 7)).toEqual([
    "open",
    "stage:0",
    "stage:1",
    "stage:2",
    "stage:3",
    "get",
    "stage:3",
  ]);
});

test.each([STAGE.segmentConflict, STAGE.segmentInvalid])(
  "a segment refused with %s abandons the stage and builds anew",
  async (code) => {
    const harness = await createStagedHealHarness();
    const document = await createLongHistoryDocument(`abandon-${code}`);
    harness.server.refuseNext("stage:2", { code, status: 409 });

    const synced = await harness.heal(document, execSql);

    expect(synced?.acceptedRecoveryBaseline).toBe(true);
    committedGroup(harness, document);
    expect(harness.server.calls.slice(0, 6)).toEqual([
      "open",
      "stage:0",
      "stage:1",
      "stage:2",
      "abandon",
      "open",
    ]);
  },
);

test("a baseline id that is taken costs only another id", async () => {
  const harness = await createStagedHealHarness();
  const document = await createLongHistoryDocument("id-conflict");
  harness.server.refuseNext("open", { code: STAGE.idConflict, status: 409 });

  const synced = await harness.heal(document, execSql);

  expect(synced?.acceptedRecoveryBaseline).toBe(true);
  committedGroup(harness, document);
  expect(harness.server.calls.slice(0, 3)).toEqual(["open", "open", "stage:0"]);
  expect(harness.server.calls).not.toContain("abandon");
});

// Restart behavior, v1: an upload lives in memory. A process that restarts
// has none, so its next heal opens a stage, which replaces the one left
// behind, and uploads from the first segment.
test("a restarted process starts the upload over", async () => {
  const harness = await createStagedHealHarness();
  const document = await createLongHistoryDocument("restart");
  harness.server.loseNextAnswer("stage:6");
  expect(await harness.heal(document, execSql)).toBeNull();
  const abandonedStage = harness.server.stage(harness.documentId)?.baselineId;
  const callsBefore = harness.server.calls.length;

  const restarted = await createTestExecSql("document-sync-staged-restart");
  try {
    await ensureDocumentTables(restarted.execSql);
    const synced = await harness.heal(document, restarted.execSql);

    expect(synced?.acceptedRecoveryBaseline).toBe(true);
    const group = committedGroup(harness, document);
    expect(group[0]?.baselineId).not.toBe(abandonedStage);
    expect(harness.server.calls.slice(callsBefore, callsBefore + 2)).toEqual([
      "open",
      "stage:0",
    ]);
  } finally {
    restarted.close();
  }
});

test("a pass that ends while its baseline uploads records nothing and keeps the stage", async () => {
  const harness = await createStagedHealHarness();
  const document = await createLongHistoryDocument("ended-pass");
  let current = true;
  harness.server.beforeNext("stage:4", () => {
    current = false;
  });

  expect(
    await harness.heal(document, execSql, {
      segmentSizes: { maxBytes: 1024, targetBytes: 256 },
      stillCurrent: () => current,
    }),
  ).toBeNull();

  expect(harness.requests).toEqual([]);
  expect(harness.terminalFailures).toEqual([]);
  expect(harness.server.calls).not.toContain("abandon");
  expect(harness.server.stage(harness.documentId)?.segments).toHaveLength(5);
});

// The staged segments are only worth what the writer can still prove. A
// history that does not give their bytes again (here another history
// altogether) ends the stage, and the same pass uploads the baseline anew.
test("a history that no longer gives the staged segments abandons the stage", async () => {
  const harness = await createStagedHealHarness();
  const document = await createLongHistoryDocument("diverged");
  harness.script.refuse = (_request, ordinal) =>
    ordinal === 1
      ? {
          code: DOCUMENT_SYNC_ERROR_CODES.checkpointCoverageConflict,
          message: "the baseline does not cover the committed frontier",
          status: 409,
        }
      : null;
  expect(await harness.heal(document, execSql)).toBeNull();
  const callsBefore = harness.server.calls.length;

  const other = await createLongHistoryDocument("diverged-other");
  const synced = await harness.heal(other, execSql);

  expect(synced?.acceptedRecoveryBaseline).toBe(true);
  committedGroup(harness, other);
  expect(harness.server.calls.slice(callsBefore, callsBefore + 4)).toEqual([
    "get",
    "abandon",
    "open",
    "stage:0",
  ]);
});
