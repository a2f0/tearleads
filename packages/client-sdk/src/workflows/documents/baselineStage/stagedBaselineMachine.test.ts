// The staged baseline upload as a pure machine: every transition, each
// refusal code, and the attempt tag that keeps a stale effect from finishing.
import { expect, test } from "bun:test";
import {
  type DocumentBaselineStageErrorCode,
  DOCUMENT_BASELINE_STAGE_ERROR_CODES as STAGE,
} from "@tearleads/validators/response";
import {
  stagedBaselineRefusalEvent,
  transitionStagedBaseline,
} from "./stagedBaselineMachine";
import {
  INITIAL_STAGED_BASELINE_STATE,
  isStagedBaselineOver,
  MAX_STAGE_READS_PER_RUN,
  type StagedBaselineEvent,
  type StagedBaselineState,
  type StagedSegmentRecord,
  stagedRecords,
  stagedSegmentCount,
} from "./stagedBaselineState";

const ID = "5f0c1d8e-6f0b-4c6e-8a55-0c2f3e1d4b6a";
const attempt = 1;

function run(
  from: StagedBaselineState,
  ...events: StagedBaselineEvent[]
): StagedBaselineState {
  return events.reduce(transitionStagedBaseline, from);
}

/** What the writer keeps of the segment at `index`. */
function record(index: number): StagedSegmentRecord {
  return {
    ciphertextHash: `ciphertext-${index}`,
    contentRecordId: `record-${index}`,
    dependencyVersionVector: "AA==",
    digestAfter: `digest-${index}`,
    metadataHash: `metadata-${index}`,
    partialEndVersionVector: "AA==",
    partialStartVersionVector: "AA==",
    plaintextHash: `plaintext-${index}`,
    updateId: `update-${index}`,
  };
}

/** A segment sent at `index` and acknowledged, as one run stages it. */
function staged(index: number, tag = attempt): StagedBaselineEvent[] {
  return [
    {
      attempt: tag,
      record: record(index),
      segmentIndex: index,
      type: "segmentSent",
    },
    { attempt: tag, segmentIndex: index, type: "segmentStaged" },
  ];
}

const planning = run(INITIAL_STAGED_BASELINE_STATE, { type: "runStarted" });
const opening = run(planning, { attempt, baselineId: ID, type: "planned" });
const staging = run(opening, { attempt, signedFor: "a", type: "stageOpened" });
const stagingThird = run(staging, ...staged(0), ...staged(1));
const committing = run(stagingThird, {
  attempt,
  segmentIndex: 2,
  type: "finalSegmentReady",
});

test("an upload opens, stages in order, and commits by its final segment", () => {
  expect(planning).toEqual({ attempt, status: "planning" });
  expect(opening).toEqual({ attempt, baselineId: ID, status: "opening" });
  expect(staging).toMatchObject({ nextSegmentIndex: 0, status: "staging" });
  expect(stagingThird).toMatchObject({ nextSegmentIndex: 2 });
  expect(committing).toEqual({
    attempt,
    baselineId: ID,
    finalSegmentIndex: 2,
    headersSignedFor: "a",
    records: [record(0), record(1)],
    status: "committing",
  });
  expect(stagedSegmentCount(committing)).toBe(2);
  const done = run(committing, { attempt, type: "commitAccepted" });
  expect(done).toEqual({ attempt, baselineId: ID, status: "done" });
  expect(isStagedBaselineOver(done)).toBe(true);
});

test("a segment staged out of turn does not move the upload", () => {
  expect(
    run(stagingThird, { attempt, segmentIndex: 5, type: "segmentStaged" }),
  ).toBe(stagingThird);
  expect(
    run(stagingThird, { attempt, segmentIndex: 1, type: "finalSegmentReady" }),
  ).toBe(stagingThird);
});

test("only the state whose effect raised an event takes it", () => {
  for (const state of [opening, staging, committing]) {
    expect(
      run(state, { attempt, nextSegmentIndex: 4, type: "stageRead" }),
    ).toBe(state);
    expect(
      run(state, {
        attempt,
        segmentIndex: 0,
        signedFor: "a",
        type: "headerResigned",
      }),
    ).toBe(state);
  }
  // A commit's answer means nothing to an upload that is still staging.
  for (const type of [
    "commitAccepted",
    "coverageRefused",
    "headersStale",
  ] as const) {
    expect(run(stagingThird, { attempt, type })).toBe(stagingThird);
  }
});

test("a coverage refusal keeps the stage for a tail", () => {
  const tail = run(committing, { attempt, type: "coverageRefused" });
  expect(tail).toMatchObject({
    attempt,
    baselineId: ID,
    records: [record(0), record(1)],
    stagedSegments: 2,
    status: "appendingTail",
  });
  // The run that brings a longer history reads the stage, confirms what is
  // staged, and stages on from there.
  const resumed = run(tail, { type: "runStarted" });
  expect(resumed).toMatchObject({
    attempt: 2,
    baselineId: ID,
    records: [record(0), record(1)],
    status: "resuming",
  });
  const confirming = run(resumed, {
    attempt: 2,
    nextSegmentIndex: 2,
    type: "stageRead",
  });
  expect(confirming).toMatchObject({ stagedSegments: 2, status: "confirming" });
  expect(
    run(confirming, {
      attempt: 2,
      signedFor: "a",
      type: "stagedHistoryConfirmed",
    }),
  ).toMatchObject({ nextSegmentIndex: 2, status: "staging" });
});

test("stale headers are signed again one segment at a time, then staging goes on", () => {
  const resigning = run(committing, { attempt, type: "headersStale" });
  // Headers the API called stale are signed for nothing the writer knows.
  expect(resigning).toMatchObject({
    headersSignedFor: null,
    nextHeaderIndex: 0,
    stagedSegments: 2,
    status: "resigningHeaders",
  });
  const resigned = (segmentIndex: number): StagedBaselineEvent => ({
    attempt,
    segmentIndex,
    signedFor: "b",
    type: "headerResigned",
  });
  const second = run(resigning, resigned(0));
  // Part way through, the headers are not all signed for one thing.
  expect(second).toMatchObject({ headersSignedFor: null, nextHeaderIndex: 1 });
  // A header signed out of turn is not counted.
  expect(run(second, resigned(0))).toBe(second);
  expect(run(second, resigned(1))).toMatchObject({
    headersSignedFor: "b",
    nextSegmentIndex: 2,
    status: "staging",
  });
});

test("a confirmed stage with stale headers signs them before it stages", () => {
  const confirming = run(
    committing,
    { type: "runStarted" },
    { attempt: 2, nextSegmentIndex: 2, type: "stageRead" },
  );
  // The run signs for something else than the staged headers were.
  const stale = { attempt: 2, signedFor: "b" } as const;
  expect(
    run(confirming, { ...stale, type: "stagedHistoryConfirmed" }),
  ).toMatchObject({
    headersSignedFor: null,
    nextHeaderIndex: 0,
    status: "resigningHeaders",
  });
  // A stage that holds nothing has no header to sign.
  const empty = run(
    staging,
    { type: "runStarted" },
    { attempt: 2, nextSegmentIndex: 0, type: "stageRead" },
  );
  expect(
    run(empty, { ...stale, type: "stagedHistoryConfirmed" }),
  ).toMatchObject({ nextSegmentIndex: 0, status: "staging" });
});

const refusals: readonly [
  DocumentBaselineStageErrorCode,
  StagedBaselineState,
  Partial<StagedBaselineState>,
][] = [
  [STAGE.notFound, stagingThird, { status: "planning" }],
  [STAGE.notFound, committing, { status: "planning" }],
  [STAGE.expired, stagingThird, { status: "planning" }],
  [STAGE.expired, committing, { status: "planning" }],
  [
    STAGE.epochStale,
    committing,
    { reason: "epoch_stale", stageStands: true, status: "abandoned" },
  ],
  [
    STAGE.epochStale,
    opening,
    { reason: "epoch_stale", stageStands: false, status: "abandoned" },
  ],
  [STAGE.idConflict, opening, { status: "planning" }],
  [STAGE.idConflict, stagingThird, { reason: "id_conflict" }],
  // At a commit: the id was committed since the stage opened. The stage
  // stands and can never commit, so it is deleted and the id chosen again.
  [
    STAGE.idConflict,
    committing,
    { reason: "id_conflict", stageStands: true, status: "abandoned" },
  ],
  [STAGE.segmentOutOfOrder, stagingThird, { status: "resuming" }],
  [STAGE.segmentOutOfOrder, committing, { status: "resuming" }],
  [STAGE.segmentConflict, stagingThird, { reason: "segment_conflict" }],
  [STAGE.segmentInvalid, stagingThird, { reason: "segment_invalid" }],
  [STAGE.headersStale, committing, { status: "resigningHeaders" }],
  [
    STAGE.limitReached,
    opening,
    { reason: "open_stage_limit", stageStands: false, status: "failed" },
  ],
  [
    STAGE.tooLarge,
    stagingThird,
    { reason: "stage_too_large", stageStands: true, status: "failed" },
  ],
  // Only a commit compares headers: the code means nothing while staging.
  [STAGE.headersStale, stagingThird, stagingThird],
];

test.each(refusals)(
  "%s moves the upload as its meaning says (%#)",
  (code, from, expected) => {
    expect(run(from, stagedBaselineRefusalEvent(code, attempt))).toMatchObject(
      expected,
    );
  },
);

test("every stage code raises its own event", () => {
  const types = Object.values(STAGE).map(
    (code) => stagedBaselineRefusalEvent(code, attempt).type,
  );
  expect(new Set(types).size).toBe(Object.values(STAGE).length);
});

test("a history that diverged, a refused group and a release abandon the stage", () => {
  for (const [type, reason] of [
    ["stagedHistoryDiverged", "history_diverged"],
    ["groupRefused", "group_invalid"],
    ["released", "released"],
  ] as const) {
    expect(run(committing, { attempt, type })).toEqual({
      attempt,
      baselineId: ID,
      reason,
      stageStands: true,
      status: "abandoned",
    });
  }
  expect(run(stagingThird, { attempt, type: "segmentLimitExceeded" })).toEqual({
    attempt,
    baselineId: ID,
    reason: "segment_limit",
    stageStands: true,
    status: "failed",
  });
});

test("only the current attempt's effects can finish", () => {
  // A later run takes the upload over: the request the earlier run left in
  // flight answers for an attempt that is no longer the state's.
  const later = run(stagingThird, { type: "runStarted" });
  expect(later).toEqual({
    attempt: 2,
    baselineId: ID,
    headersSignedFor: "a",
    reads: 0,
    records: [record(0), record(1)],
    status: "resuming",
  });
  for (const event of [
    { attempt, segmentIndex: 2, type: "segmentStaged" },
    { attempt, type: "commitAccepted" },
    { attempt, type: "stageExpired" },
    { attempt, type: "released" },
  ] satisfies StagedBaselineEvent[]) {
    expect(run(later, event)).toBe(later);
  }
});

// The records of what is staged, and what its headers were signed for, are
// the machine's own state. An answer a superseded run was waiting for is an
// event of an attempt that is no longer the state's, so it cannot shorten,
// lengthen or re-tag them under the run that took over.
test("a superseded run's answers change nothing the live run remembers", () => {
  // Run 2 resumed, confirmed, and staged a third segment.
  const live = run(
    stagingThird,
    { type: "runStarted" },
    { attempt: 2, nextSegmentIndex: 2, type: "stageRead" },
    { attempt: 2, signedFor: "a", type: "stagedHistoryConfirmed" },
    ...staged(2, 2),
  );
  expect(stagedRecords(live)).toEqual([record(0), record(1), record(2)]);
  for (const late of [
    // Run 1's read of the stage, as it stood with one segment.
    { attempt, nextSegmentIndex: 1, type: "stageRead" },
    { attempt, record: record(9), segmentIndex: 3, type: "segmentSent" },
    { attempt, segmentIndex: 0, signedFor: "z", type: "headerResigned" },
    { attempt, signedFor: "z", type: "stagedHistoryConfirmed" },
    { attempt, signedFor: "z", type: "stageOpened" },
    { attempt, type: "headersStale" },
  ] satisfies StagedBaselineEvent[]) {
    expect(run(live, late)).toBe(live);
  }
});

test("a record is kept before its segment is sent, and counted once staged", () => {
  const sent = run(staging, {
    attempt,
    record: record(0),
    segmentIndex: 0,
    type: "segmentSent",
  });
  // The answer may be lost: the record stands, the index does not move.
  expect(sent).toMatchObject({ nextSegmentIndex: 0, records: [record(0)] });
  // Sent again at the same index, the later record replaces the earlier.
  const again = { ...record(0), updateId: "update-again" };
  expect(
    run(sent, {
      attempt,
      record: again,
      segmentIndex: 0,
      type: "segmentSent",
    }),
  ).toMatchObject({ records: [again] });
  // A segment is not staged before its record is kept.
  expect(
    run(staging, { attempt, segmentIndex: 0, type: "segmentStaged" }),
  ).toBe(staging);
  // A final segment is never staged: a record sent at its index is dropped.
  expect(
    stagedRecords(
      run(sent, { attempt, segmentIndex: 0, type: "finalSegmentReady" }),
    ),
  ).toEqual([]);
});

test("a read keeps only what the stage acknowledges", () => {
  const resumed = run(stagingThird, ...staged(2).slice(0, 1), {
    type: "runStarted",
  });
  expect(stagedRecords(resumed)).toHaveLength(3);
  // The third segment's answer was lost and the stage does not hold it.
  expect(
    run(resumed, { attempt: 2, nextSegmentIndex: 2, type: "stageRead" }),
  ).toMatchObject({
    reads: 1,
    records: [record(0), record(1)],
    stagedSegments: 2,
    status: "confirming",
  });
  // A stage that holds more than the writer sent is not the writer's.
  expect(
    run(resumed, { attempt: 2, nextSegmentIndex: 4, type: "stageRead" }),
  ).toMatchObject({ reason: "history_diverged", status: "abandoned" });
});

// A stage that is never where its own answers put it would keep one run
// reading, confirming and sending without end.
test("a run reads its stage only so often before it gives the upload up", () => {
  let state = run(stagingThird, { type: "runStarted" });
  for (let read = 1; read <= MAX_STAGE_READS_PER_RUN; read += 1) {
    state = run(
      state,
      { attempt: 2, nextSegmentIndex: 2, type: "stageRead" },
      { attempt: 2, signedFor: "a", type: "stagedHistoryConfirmed" },
    );
    expect(state).toMatchObject({ reads: read, status: "staging" });
    state = run(state, { attempt: 2, type: "segmentOutOfOrder" });
    expect(state.status).toBe(
      read < MAX_STAGE_READS_PER_RUN ? "resuming" : "abandoned",
    );
  }
  expect(state).toMatchObject({
    reason: "stage_unsettled",
    stageStands: true,
    status: "abandoned",
  });
  // The next run starts its own count.
  const next = run(
    stagingThird,
    { type: "runStarted" },
    { type: "runStarted" },
  );
  expect(next).toMatchObject({ attempt: 3, reads: 0, status: "resuming" });
});

test("an upload that is over moves only by a new run, which plans again", () => {
  const done = run(committing, { attempt, type: "commitAccepted" });
  const abandoned = run(committing, { attempt, type: "segmentConflict" });
  for (const over of [done, abandoned]) {
    expect(run(over, { attempt, type: "stageExpired" })).toBe(over);
    expect(run(over, { type: "runStarted" })).toEqual({
      attempt: 2,
      status: "planning",
    });
  }
  // A planning upload takes nothing but its plan.
  expect(run(planning, { attempt, signedFor: "a", type: "stageOpened" })).toBe(
    planning,
  );
  expect(run(opening, { attempt, baselineId: "other", type: "planned" })).toBe(
    opening,
  );
});
