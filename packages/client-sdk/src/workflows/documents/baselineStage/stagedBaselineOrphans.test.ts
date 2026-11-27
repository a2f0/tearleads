import { expect, test } from "bun:test";
import { DOCUMENT_BASELINE_STAGE_ERROR_CODES as STAGE } from "@tearleads/validators/response";
import { DOCUMENT_BASELINE_STAGE_IDLE_SECONDS } from "@tearleads/validators/util";
import { FakeBaselineStageServer } from "../../../../test/helpers/workflows/fakeBaselineStageServer";
import {
  abandonOrphanedStages,
  ORPHANED_STAGE_IDLE_MS,
} from "./stagedBaselineOrphans";
import { getOrCreateStagedBaselineUploads } from "./stagedBaselineUploads";

const NOW = Date.parse("2026-07-26T12:00:00.000Z");
const IDLE_MS = DOCUMENT_BASELINE_STAGE_IDLE_SECONDS * 1000;
const MINUTE_MS = 60 * 1000;

/** An open stage last touched `idleMs` before `NOW`. */
function openStage(name: string, idleMs: number) {
  return {
    baselineId: `baseline-${name}`,
    documentId: `document-${name}`,
    expiresAt: new Date(NOW - idleMs + IDLE_MS).toISOString(),
  };
}

const PLAN = {
  contentKey: new Uint8Array(32),
  contentKeyCommitment: "a".repeat(64),
  contentKeyEpoch: 2,
  linkSetEvent: undefined,
  signedAt: "2026-07-26T11:00:00.000Z",
};

function search(openStages: ReturnType<typeof openStage>[]) {
  const server = new FakeBaselineStageServer();
  server.elsewhere.push(...openStages);
  const uploads = getOrCreateStagedBaselineUploads(undefined);
  return {
    abandon: () =>
      abandonOrphanedStages({ api: server.api, now: NOW, openStages, uploads }),
    server,
    uploads,
  };
}

test("a stage is an orphan once it has been idle ten minutes", async () => {
  expect(ORPHANED_STAGE_IDLE_MS).toBe(10 * MINUTE_MS);
  const young = openStage("young", ORPHANED_STAGE_IDLE_MS - 1);
  const { abandon, server } = search([
    young,
    openStage("old", ORPHANED_STAGE_IDLE_MS),
  ]);

  expect(await abandon()).toBe(1);

  expect(server.elsewhere).toEqual([young]);
});

// One database holds at most one upload a document, and a stage it is
// filling may stand untouched for as long as its next attempt takes to
// come: a tail waits for a longer history, a lost answer for the next pass.
test("a stage this database is uploading is never an orphan, however idle", async () => {
  const mine = openStage("mine", 55 * MINUTE_MS);
  const replaced = { ...mine, baselineId: "baseline-replaced" };
  const { abandon, server, uploads } = search([mine, replaced]);
  const upload = uploads.begin(mine.documentId, PLAN);
  const { attempt } = upload.dispatch({ type: "runStarted" });
  upload.dispatch({ attempt, baselineId: mine.baselineId, type: "planned" });
  upload.dispatch({ attempt, type: "stageOpened" });
  expect(upload.state.status).toBe("staging");

  // The document's other stage is not the one the upload fills.
  expect(await abandon()).toBe(1);
  expect(server.elsewhere).toEqual([mine]);

  // An upload that gave its stage up no longer speaks for it. The other
  // stage is already gone, which frees its place as well.
  upload.dispatch({ attempt, type: "segmentConflict" });
  expect(upload.state.status).toBe("abandoned");
  expect(await abandon()).toBe(2);
  expect(server.elsewhere).toEqual([]);
});

test("an upload that has not opened its stage tracks none", async () => {
  const { uploads } = search([]);
  const upload = uploads.begin("document-a", PLAN);
  expect(uploads.tracks("document-a", "baseline-a")).toBe(false);
  const { attempt } = upload.dispatch({ type: "runStarted" });
  expect(uploads.tracks("document-a", "baseline-a")).toBe(false);
  upload.dispatch({ attempt, baselineId: "baseline-a", type: "planned" });
  expect(uploads.tracks("document-a", "baseline-a")).toBe(true);
  expect(uploads.tracks("document-a", "baseline-b")).toBe(false);
  expect(uploads.tracks("document-b", "baseline-a")).toBe(false);
  uploads.end(upload);
  expect(uploads.tracks("document-a", "baseline-a")).toBe(false);
});

test("an expiry that does not parse leaves its stage alone", async () => {
  const unreadable = { ...openStage("a", IDLE_MS), expiresAt: "soon" };
  const { abandon, server } = search([unreadable]);

  expect(await abandon()).toBe(0);

  expect(server.calls).toEqual([]);
});

// A stage's expiry is the sooner of an hour after its last write and a day
// after it opened. In its last hour a stage that is still being filled
// reads as idle since the hour before its end, so it can be taken for an
// orphan in its last fifty minutes: a known over-reading, for a stage that
// is about to expire under its writer anyway.
test("a stage in the last fifty minutes of its day reads as an orphan", async () => {
  // A day after it opened is `remainingMs` from now.
  const capped = (name: string, remainingMs: number) => ({
    ...openStage(name, 0),
    expiresAt: new Date(NOW + remainingMs).toISOString(),
  });
  const kept = capped("kept", 50 * MINUTE_MS + 1);
  const { abandon, server } = search([kept, capped("taken", 50 * MINUTE_MS)]);

  expect(await abandon()).toBe(1);

  expect(server.elsewhere).toEqual([kept]);
});

test("a stage already gone has freed its place, and a failed abandon has not", async () => {
  const stages = ["a", "b", "c"].map((name) => openStage(name, IDLE_MS));
  const { abandon, server } = search(stages);
  server.refuseNext("abandon", { code: STAGE.notFound, status: 404 });
  server.refuseNext("abandon", { status: 503 });

  expect(await abandon()).toBe(2);

  expect(server.calls).toEqual(["abandon", "abandon", "abandon"]);
});

test("an abandon that throws is taken as one that failed", async () => {
  const { server, uploads } = search([]);
  const api = {
    ...server.api,
    abandonDocumentBaselineStageResult: async () => {
      throw new Error("the session ended");
    },
  };

  expect(
    await abandonOrphanedStages({
      api,
      now: NOW,
      openStages: [openStage("a", IDLE_MS)],
      uploads,
    }),
  ).toBe(0);
});
