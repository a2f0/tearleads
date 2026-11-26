import { expect, test } from "bun:test";
import {
  type BaselineGroupEvent,
  type BaselineGroupFault,
  type BaselineGroupState,
  baselineGroupRunOf,
  baselineGroupStateFromRun,
  baselineGroupTransition,
} from "./baselineGroupMachine";

const A = "baseline-a";
const B = "baseline-b";
const OUTSIDE: BaselineGroupState = { status: "outside" };

type Segment = Extract<BaselineGroupEvent, { type: "segment" }>;

/**
 * A segment as the driver hands it over: the chain says what the digest was
 * before it (`d<index>`) and is after it (`d<index + 1>`).
 */
function segment(
  index: number,
  overrides: Partial<Segment> & { final?: boolean } = {},
): Segment {
  const { final, ...rest } = overrides;
  return {
    baselineId: A,
    chain: { after: final ? null : `d${index + 1}`, before: `d${index}` },
    cold: true,
    index,
    seal: final ? { count: index + 1, digest: `d${index}` } : null,
    type: "segment",
    ...rest,
  };
}

function run(state: BaselineGroupState, events: BaselineGroupEvent[]) {
  return events.reduce(baselineGroupTransition, state);
}

const ORDINARY: BaselineGroupEvent = { type: "ordinary_update" };
const COMPLETE: BaselineGroupEvent = { type: "pull_complete" };

test("a group served whole on a cold pull is followed to its final segment", () => {
  expect(run(OUTSIDE, [segment(0)])).toEqual({
    baselineId: A,
    digest: "d1",
    nextIndex: 1,
    status: "whole",
  });
  expect(run(OUTSIDE, [segment(0), segment(1)])).toEqual({
    baselineId: A,
    digest: "d2",
    nextIndex: 2,
    status: "whole",
  });
  expect(
    run(OUTSIDE, [
      ORDINARY,
      segment(0),
      segment(1),
      segment(2, { final: true }),
      ORDINARY,
      COMPLETE,
    ]),
  ).toEqual(OUTSIDE);
  // One segment is a whole group: it signs the digest every group starts from.
  expect(run(OUTSIDE, [segment(0, { final: true }), COMPLETE])).toEqual(
    OUTSIDE,
  );
});

test("a group followed whole fails on any break in its run", () => {
  const cases: [BaselineGroupFault, BaselineGroupEvent[]][] = [
    ["segment_out_of_order", [segment(0), segment(2)]],
    ["segment_out_of_order", [segment(0), segment(0)]],
    ["segment_out_of_order", [segment(0), segment(1), segment(0)]],
    ["mixed_baseline", [segment(0), segment(1, { baselineId: B })]],
    ["mixed_baseline", [segment(0), segment(0, { baselineId: B })]],
    ["group_interrupted", [segment(0), ORDINARY, segment(1)]],
    ["final_missing", [segment(0), segment(1), COMPLETE]],
    [
      "count_mismatch",
      [segment(0), segment(1, { seal: { count: 3, digest: "d1" } })],
    ],
    [
      "digest_mismatch",
      [segment(0), segment(1, { seal: { count: 2, digest: "other" } })],
    ],
    // The digest a final segment must match is the run's, not the event's.
    [
      "digest_mismatch",
      [
        segment(0),
        segment(1, {
          chain: { after: null, before: "forged" },
          seal: { count: 2, digest: "forged" },
        }),
      ],
    ],
    // A segment the driver could not chain cannot continue the run.
    ["digest_mismatch", [segment(0), segment(1, { chain: null })]],
  ];
  for (const [fault, events] of cases) {
    expect([fault, run(OUTSIDE, events)]).toEqual([
      fault,
      { fault, status: "failed" },
    ]);
  }
});

test("a failure is final", () => {
  const failed = run(OUTSIDE, [segment(0), segment(2)]);
  expect(run(failed, [segment(1), segment(2, { final: true }), COMPLETE])).toBe(
    failed,
  );
});

test("a one-segment group is checked whoever asks", () => {
  for (const cold of [true, false]) {
    expect(run(OUTSIDE, [segment(0, { cold, final: true })])).toEqual(OUTSIDE);
    expect(
      run(OUTSIDE, [segment(0, { cold, seal: { count: 1, digest: "other" } })]),
    ).toEqual({ fault: "digest_mismatch", status: "failed" });
    expect(
      run(OUTSIDE, [segment(0, { cold, seal: { count: 2, digest: "d0" } })]),
    ).toEqual({ fault: "count_mismatch", status: "failed" });
  }
});

test("a reader that sent a version follows a group in part", () => {
  const warm = (index: number, overrides: Parameters<typeof segment>[1] = {}) =>
    segment(index, { chain: null, cold: false, ...overrides });
  // The server leaves out segments the reader's version holds, so indices
  // may skip, and the group may end without its final segment.
  expect(run(OUTSIDE, [warm(0), warm(2), warm(5)])).toEqual({
    baselineId: A,
    lastIndex: 5,
    status: "partial",
  });
  expect(run(OUTSIDE, [warm(1), warm(3), ORDINARY, COMPLETE])).toEqual(OUTSIDE);
  expect(run(OUTSIDE, [warm(1), COMPLETE])).toEqual(OUTSIDE);
  expect(run(OUTSIDE, [warm(1), warm(4, { final: true }), COMPLETE])).toEqual(
    OUTSIDE,
  );
  // Another group may begin where the rest of this one was held already.
  expect(run(OUTSIDE, [warm(1), warm(0, { baselineId: B })])).toEqual({
    baselineId: B,
    lastIndex: 0,
    status: "partial",
  });

  // Indices still only rise, and a final segment's count fits its index.
  for (const events of [
    [warm(2), warm(1)],
    [warm(2), warm(2)],
  ]) {
    expect(run(OUTSIDE, events)).toEqual({
      fault: "segment_out_of_order",
      status: "failed",
    });
  }
  expect(
    run(OUTSIDE, [warm(1), warm(4, { seal: { count: 7, digest: "any" } })]),
  ).toEqual({ fault: "count_mismatch", status: "failed" });
  expect(
    run(OUTSIDE, [warm(3, { seal: { count: 3, digest: "any" } })]),
  ).toEqual({ fault: "count_mismatch", status: "failed" });
});

test("a cold pull that first meets a later segment follows the group in part", () => {
  expect(run(OUTSIDE, [segment(2, { chain: null })])).toEqual({
    baselineId: A,
    lastIndex: 2,
    status: "partial",
  });
});

test("a run crosses pages through its continuation", () => {
  const firstPage = run(OUTSIDE, [segment(0), segment(1)]);
  const carried = baselineGroupRunOf(firstPage);
  expect(carried).toEqual({ baselineId: A, digest: "d2", nextIndex: 2 });
  const nextPage = baselineGroupStateFromRun(carried);
  expect(run(nextPage, [segment(2), segment(3, { final: true })])).toEqual(
    OUTSIDE,
  );
  // The next page must go on where the run stopped.
  expect(run(nextPage, [segment(3, { final: true })])).toEqual({
    fault: "segment_out_of_order",
    status: "failed",
  });
  expect(run(nextPage, [COMPLETE])).toEqual({
    fault: "final_missing",
    status: "failed",
  });

  // Only a group followed whole is carried; no run starts outside one.
  for (const state of [
    OUTSIDE,
    run(OUTSIDE, [segment(1, { chain: null, cold: false })]),
    run(OUTSIDE, [segment(0), segment(2)]),
  ]) {
    expect(baselineGroupRunOf(state)).toBeNull();
  }
  expect(baselineGroupStateFromRun(null)).toEqual(OUTSIDE);
  expect(baselineGroupStateFromRun(undefined)).toEqual(OUTSIDE);
});
