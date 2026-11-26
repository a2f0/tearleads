// The staged baseline upload as a pure machine: every transition, each
// refusal code, and the attempt tag that keeps a stale effect from finishing.
import { expect, test } from "bun:test";
import {
  type DocumentBaselineStageErrorCode,
  DOCUMENT_BASELINE_STAGE_ERROR_CODES as STAGE,
} from "@tearleads/validators/response";
import {
  INITIAL_STAGED_BASELINE_STATE,
  isStagedBaselineOver,
  type StagedBaselineEvent,
  type StagedBaselineState,
  stagedBaselineRefusalEvent,
  stagedSegmentCount,
  transitionStagedBaseline,
} from "./stagedBaselineMachine";

const ID = "5f0c1d8e-6f0b-4c6e-8a55-0c2f3e1d4b6a";
const attempt = 1;

function run(
  from: StagedBaselineState,
  ...events: StagedBaselineEvent[]
): StagedBaselineState {
  return events.reduce(transitionStagedBaseline, from);
}

const planning = run(INITIAL_STAGED_BASELINE_STATE, { type: "runStarted" });
const opening = run(planning, { attempt, baselineId: ID, type: "planned" });
const staging = run(opening, { attempt, type: "stageOpened" });
const stagingThird = run(
  staging,
  { attempt, segmentIndex: 0, type: "segmentStaged" },
  { attempt, segmentIndex: 1, type: "segmentStaged" },
);
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
      run(state, { attempt, segmentIndex: 0, type: "headerResigned" }),
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
  expect(tail).toEqual({
    attempt,
    baselineId: ID,
    stagedSegments: 2,
    status: "appendingTail",
  });
  // The run that brings a longer history reads the stage, confirms what is
  // staged, and stages on from there.
  const resumed = run(tail, { type: "runStarted" });
  expect(resumed).toEqual({ attempt: 2, baselineId: ID, status: "resuming" });
  const confirming = run(resumed, {
    attempt: 2,
    nextSegmentIndex: 2,
    type: "stageRead",
  });
  expect(confirming).toMatchObject({ stagedSegments: 2, status: "confirming" });
  expect(
    run(confirming, {
      attempt: 2,
      headersCurrent: true,
      type: "stagedHistoryConfirmed",
    }),
  ).toMatchObject({ nextSegmentIndex: 2, status: "staging" });
});

test("stale headers are signed again one segment at a time, then staging goes on", () => {
  const resigning = run(committing, { attempt, type: "headersStale" });
  expect(resigning).toMatchObject({
    nextHeaderIndex: 0,
    stagedSegments: 2,
    status: "resigningHeaders",
  });
  const second = run(resigning, {
    attempt,
    segmentIndex: 0,
    type: "headerResigned",
  });
  expect(second).toMatchObject({ nextHeaderIndex: 1 });
  // A header signed out of turn is not counted.
  expect(
    run(second, { attempt, segmentIndex: 0, type: "headerResigned" }),
  ).toBe(second);
  expect(
    run(second, { attempt, segmentIndex: 1, type: "headerResigned" }),
  ).toMatchObject({ nextSegmentIndex: 2, status: "staging" });
});

test("a confirmed stage with stale headers signs them before it stages", () => {
  const confirming = run(
    committing,
    { type: "runStarted" },
    { attempt: 2, nextSegmentIndex: 2, type: "stageRead" },
  );
  const stale = { attempt: 2, headersCurrent: false } as const;
  expect(
    run(confirming, { ...stale, type: "stagedHistoryConfirmed" }),
  ).toMatchObject({ nextHeaderIndex: 0, status: "resigningHeaders" });
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
  [STAGE.segmentOutOfOrder, stagingThird, { status: "resuming" }],
  [STAGE.segmentOutOfOrder, committing, { status: "resuming" }],
  [STAGE.segmentConflict, stagingThird, { reason: "segment_conflict" }],
  [STAGE.segmentInvalid, stagingThird, { reason: "segment_invalid" }],
  [STAGE.headersStale, committing, { status: "resigningHeaders" }],
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
  expect(later).toEqual({ attempt: 2, baselineId: ID, status: "resuming" });
  for (const event of [
    { attempt, segmentIndex: 2, type: "segmentStaged" },
    { attempt, type: "commitAccepted" },
    { attempt, type: "stageExpired" },
    { attempt, type: "released" },
  ] satisfies StagedBaselineEvent[]) {
    expect(run(later, event)).toBe(later);
  }
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
  expect(run(planning, { attempt, type: "stageOpened" })).toBe(planning);
  expect(run(opening, { attempt, baselineId: "other", type: "planned" })).toBe(
    opening,
  );
});
