// Two attempts at one document's staged baseline: a pass whose request is
// still on the wire when a later one takes the upload over, an answer that
// arrives for a run that is no longer the upload's, and a stage that never
// stands where its own answers put it.
import { afterEach, beforeEach, expect, test } from "bun:test";
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
import { reusableStagedBaselinePlan } from "../baselineStage/rotationBaselineWriter";
import {
  MAX_STAGE_READS_PER_RUN,
  stagedRecords,
} from "../baselineStage/stagedBaselineState";
import { getOrCreateStagedBaselineUploads } from "../baselineStage/stagedBaselineUploads";
import { settleSyncBaselineCommit } from "../syncFailures/syncBaselineCommit";

let execSql: ExecSql;
let closeExecSql: () => void;

beforeEach(async () => {
  ({ close: closeExecSql, execSql } = await createTestExecSql(
    "document-sync-staged-races",
  ));
  await ensureDocumentTables(execSql);
});

afterEach(() => closeExecSql());

function gate() {
  let open: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
}

const coverage = {
  code: DOCUMENT_SYNC_ERROR_CODES.checkpointCoverageConflict,
  message: "the baseline does not cover the committed frontier",
  status: 409,
};

// A pass can end, or lose its lane, with a stage request still on the wire,
// and an unlink shares the upload and holds no lock a sync holds: a later
// run can start while an earlier one waits. The earlier run's answer then
// arrives for an attempt that is no longer the upload's. It must change
// nothing the later run remembers of the stage, and it is nobody's failure.
test("a superseded run's late answer changes nothing and reports nothing", async () => {
  const harness = await createStagedHealHarness();
  const { documentId, server } = harness;
  const document = await createLongHistoryDocument("superseded-run");
  const uploads = getOrCreateStagedBaselineUploads(execSql);
  server.loseNextAnswer("stage:4");
  expect(await harness.heal(document, execSql)).toBeNull();
  expect(server.stage(documentId)?.segments).toHaveLength(5);
  harness.terminalFailures.length = 0;

  // The second run reads the stage, and its answer is held on the wire.
  const read = gate();
  const answered = gate();
  server.afterNext("get", async () => {
    read.open();
    await answered.opened;
  });
  const second = harness.heal(document, execSql);
  await read.opened;

  // The third run takes the upload over and stages on to its ninth segment.
  const reached = gate();
  const released = gate();
  server.beforeNext("stage:8", async () => {
    reached.open();
    await released.opened;
  });
  harness.script.refuse = () => coverage;
  const third = harness.heal(document, execSql);
  await reached.opened;
  const live = uploads.get(documentId)?.state;
  expect(
    stagedRecords(live ?? { attempt: 0, status: "planning" }),
  ).toHaveLength(9);

  // The second run's answer arrives: the stage as it stood, five segments.
  answered.open();
  expect(await second).toBeNull();
  expect(uploads.get(documentId)?.state).toBe(live);
  // A local race is not a failure: nothing is recorded for the run.
  expect(harness.terminalFailures).toEqual([]);
  expect(harness.abandonedReasons).toContain(
    "a later attempt took over the rotation baseline upload",
  );
  expect(server.calls).not.toContain("abandon");

  // The third run goes on, with a record for every segment it staged.
  released.open();
  expect(await third).toBeNull();
  const staged = server.stage(documentId)?.segments ?? [];
  const state = uploads.get(documentId)?.state;
  expect(state?.status).toBe("appendingTail");
  expect(
    stagedRecords(state ?? { attempt: 0, status: "planning" }).map(
      (record) => record.updateId,
    ),
  ).toEqual(staged.map((segment) => segment.id));

  // So the run that brings a longer history can confirm and commit.
  harness.script.refuse = null;
  appendHistory(document, 4);
  const synced = await harness.heal(document, execSql);
  expect(synced?.acceptedRecoveryBaseline).toBe(true);
  expect(server.committed.at(-1)?.length).toBeGreaterThan(staged.length);
}, 60_000);

// A refusal that would give the upload up is no different: it answers a run
// that no longer owns the upload, and the stage it would delete is the
// later run's.
test("a superseded run's late refusal does not give up the later run's upload", async () => {
  const harness = await createStagedHealHarness();
  const { documentId, server } = harness;
  const document = await createLongHistoryDocument("superseded-refusal");
  server.loseNextAnswer("stage:4");
  expect(await harness.heal(document, execSql)).toBeNull();
  harness.terminalFailures.length = 0;

  // The second run's read is refused for access, and the answer is held.
  const read = gate();
  const answered = gate();
  server.refuseNext("get", { message: "write access denied", status: 403 });
  server.afterNext("get", async () => {
    read.open();
    await answered.opened;
  });
  const second = harness.heal(document, execSql);
  await read.opened;

  // The third run takes the upload over and is part way through it.
  const reached = gate();
  const released = gate();
  server.beforeNext("stage:8", async () => {
    reached.open();
    await released.opened;
  });
  const third = harness.heal(document, execSql);
  await reached.opened;

  answered.open();
  expect(await second).toBeNull();
  expect(server.calls).not.toContain("abandon");
  expect(server.stage(documentId)?.segments).toHaveLength(8);
  expect(harness.terminalFailures).toEqual([]);

  released.open();
  const synced = await third;
  expect(synced?.acceptedRecoveryBaseline).toBe(true);
}, 60_000);

// The answer to a sync belongs to the run whose final segment it carried.
// A later run that reached its own commit of the same stage is not moved
// by it.
test("a sync's answer settles only the run that sent it", async () => {
  const harness = await createStagedHealHarness();
  const { documentId, server } = harness;
  const document = await createLongHistoryDocument("settle-tag");
  const uploads = getOrCreateStagedBaselineUploads(execSql);
  // The first run's sync is refused for coverage only after a second run
  // has resumed the upload and reached its own commit.
  let firstAttempt: number | undefined;
  let settled: Promise<boolean> | undefined;
  harness.script.refuse = (request, ordinal) => {
    if (ordinal !== 1) return null;
    const upload = uploads.get(documentId);
    firstAttempt = upload?.state.attempt;
    // The second run: read, confirmed for the same signer, final ready.
    const before = upload?.state;
    const signedFor =
      before && "headersSignedFor" in before ? before.headersSignedFor : null;
    const attempt = upload?.dispatch({ type: "runStarted" }).attempt ?? 0;
    const staged = server.stage(documentId)?.segments.length ?? 0;
    upload?.dispatch({ attempt, nextSegmentIndex: staged, type: "stageRead" });
    upload?.dispatch({
      attempt,
      signedFor: signedFor ?? "",
      type: "stagedHistoryConfirmed",
    });
    upload?.dispatch({
      attempt,
      segmentIndex: staged,
      type: "finalSegmentReady",
    });
    expect(request.baselineStageId).toBeString();
    return coverage;
  };

  expect(await harness.heal(document, execSql)).toBeNull();

  // The upload is where the second run left it, waiting on its own commit,
  // and not `appendingTail`.
  const upload = uploads.get(documentId);
  expect(firstAttempt).toBe(1);
  expect(upload?.state).toMatchObject({ attempt: 2, status: "committing" });
  // The same answer, told directly under the first run's tag, and under
  // none: neither settles the second run.
  for (const attempt of [firstAttempt, undefined]) {
    settled = settleSyncBaselineCommit({
      apiClient: server.api,
      attempt,
      baselineStageId: server.stage(documentId)?.baselineId,
      documentId,
      execSql,
      outcome: { code: coverage.code, ok: false },
    });
    expect(await settled).toBe(false);
    expect(upload?.state).toMatchObject({ attempt: 2, status: "committing" });
  }
  // The second run's own answer does settle it.
  expect(
    await settleSyncBaselineCommit({
      apiClient: server.api,
      attempt: 2,
      baselineStageId: server.stage(documentId)?.baselineId,
      documentId,
      execSql,
      outcome: { code: coverage.code, ok: false },
    }),
  ).toBe(false);
  expect(upload?.state.status).toBe("appendingTail");
});

// A stage that is never where its own answers put it would keep one run
// reading, confirming and sending for as long as the pass lived.
test("a run gives up a stage that never stands where it is told", async () => {
  const harness = await createStagedHealHarness();
  const { documentId, server } = harness;
  const document = await createLongHistoryDocument("unsettled-stage");
  for (let refusal = 0; refusal < 3 * MAX_STAGE_READS_PER_RUN; refusal += 1) {
    server.refuseNext("stage:3", {
      code: STAGE.segmentOutOfOrder,
      nextSegmentIndex: 3,
      status: 409,
    });
  }

  expect(await harness.heal(document, execSql)).toBeNull();

  expect(server.calls.filter((call) => call === "get")).toHaveLength(
    MAX_STAGE_READS_PER_RUN,
  );
  expect(server.calls.at(-1)).toBe("abandon");
  expect(server.stage(documentId)).toBeNull();
  expect(harness.requests).toEqual([]);
  expect(harness.terminalFailures.map((failure) => failure.message)).toEqual([
    "Document rotation baseline stage was abandoned: stage_unsettled",
  ]);
});

// A heal's request carries its key wrapped for every linked container, so
// its upload remembers them: an attempt that leaves one out gets no plan.
test("a heal's upload remembers the containers its key was sent to", async () => {
  const harness = await createStagedHealHarness();
  const { documentId } = harness;
  const document = await createLongHistoryDocument("heal-key-targets");
  harness.script.refuse = () => coverage;
  expect(await harness.heal(document, execSql)).toBeNull();
  const [request] = harness.requests;
  const bundle = request?.contentKeyBundle;
  if (!bundle) throw new Error("Expected the heal to send its bundle");
  expect(bundle.targets.length).toBeGreaterThan(0);

  const held = (targets: typeof bundle.targets) =>
    reusableStagedBaselinePlan(
      execSql,
      documentId,
      bundle.contentKeyEpoch,
      targets,
    );

  expect(held(bundle.targets.slice(1))).toBeNull();
  expect(held(bundle.targets)?.contentKeyCommitment).toBe(
    bundle.contentKeyCommitment,
  );
});
