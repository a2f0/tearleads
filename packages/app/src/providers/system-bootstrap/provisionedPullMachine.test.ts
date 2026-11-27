import { describe, expect, test } from "bun:test";
import {
  INITIAL_PROVISIONED_PULL_STATE,
  PROVISIONED_PULL_LISTING_LIMIT,
  PROVISIONED_PULL_TICK_LIMIT,
  type ProvisionedPullEvent,
  type ProvisionedPullState,
  transitionProvisionedPull,
} from "./provisionedPullMachine";

const SEQUENCE_A = { name: "sequence-a" };
const SEQUENCE_B = { name: "sequence-b" };
const PULL_A = { name: "pull-a" };
const PULL_B = { name: "pull-b" };
const MISSING = ["trash-slot"];

type PullState<S extends ProvisionedPullState["status"]> = Extract<
  ProvisionedPullState,
  { status: S }
>;

const idle: PullState<"idle"> = {
  listings: 0,
  pull: null,
  status: "idle",
  ticks: 0,
};
const surfacingA: PullState<"surfacing"> = {
  listings: 0,
  pull: null,
  sequence: SEQUENCE_A,
  status: "surfacing",
  ticks: 0,
};
const pollingA: PullState<"polling"> = {
  listings: 0,
  pull: null,
  sequence: SEQUENCE_A,
  status: "polling",
  ticks: 0,
};
const pullingA: PullState<"polling"> = {
  ...pollingA,
  pull: PULL_A,
  ticks: 1,
};
const settled: ProvisionedPullState = { status: "settled" };
const abandoned: ProvisionedPullState = {
  listings: PROVISIONED_PULL_LISTING_LIMIT,
  missingSlots: MISSING,
  status: "abandoned",
};

function run(
  state: ProvisionedPullState,
  events: ReadonlyArray<ProvisionedPullEvent>,
): ProvisionedPullState {
  return events.reduce(transitionProvisionedPull, state);
}

function tickA(pull: object): ProvisionedPullEvent {
  return { missingSlots: MISSING, pull, sequence: SEQUENCE_A, type: "tick" };
}

describe("provisioned pull transitions", () => {
  test("a machine starts idle with nothing spent", () => {
    expect(INITIAL_PROVISIONED_PULL_STATE).toEqual(idle);
  });

  test.each<
    [string, ProvisionedPullState, ProvisionedPullEvent, ProvisionedPullState]
  >([
    ["idle + start", idle, { sequence: SEQUENCE_A, type: "start" }, surfacingA],
    [
      "idle with spent listings and a pull in flight + start keeps them",
      { listings: 1, pull: PULL_A, status: "idle", ticks: 3 },
      { sequence: SEQUENCE_A, type: "start" },
      { ...surfacingA, listings: 1, pull: PULL_A, ticks: 3 },
    ],
    [
      "settled + start begins a new budget",
      settled,
      { sequence: SEQUENCE_A, type: "start" },
      surfacingA,
    ],
    [
      "abandoned + start",
      abandoned,
      { sequence: SEQUENCE_A, type: "start" },
      abandoned,
    ],
    [
      "surfacing + surfaced with nothing missing",
      surfacingA,
      { missingSlots: [], sequence: SEQUENCE_A, type: "surfaced" },
      settled,
    ],
    [
      "surfacing + surfaced with a slot missing",
      surfacingA,
      { missingSlots: MISSING, sequence: SEQUENCE_A, type: "surfaced" },
      pollingA,
    ],
    [
      "surfacing with an earlier run's pull in flight + surfaced keeps it",
      { ...surfacingA, pull: PULL_A },
      { missingSlots: MISSING, sequence: SEQUENCE_A, type: "surfaced" },
      { ...pollingA, pull: PULL_A },
    ],
    [
      "surfacing with a spent budget + surfaced",
      { ...surfacingA, listings: PROVISIONED_PULL_LISTING_LIMIT },
      { missingSlots: MISSING, sequence: SEQUENCE_A, type: "surfaced" },
      abandoned,
    ],
    ["polling + tick starts a pull", pollingA, tickA(PULL_A), pullingA],
    [
      "polling with a pull in flight + tick only counts",
      pullingA,
      tickA(PULL_B),
      { ...pullingA, ticks: 2 },
    ],
    [
      "polling + tick with nothing missing",
      pullingA,
      { missingSlots: [], pull: PULL_B, sequence: SEQUENCE_A, type: "tick" },
      settled,
    ],
    [
      "polling with spent listings + tick",
      { ...pollingA, listings: PROVISIONED_PULL_LISTING_LIMIT },
      tickA(PULL_A),
      abandoned,
    ],
    [
      "polling with spent ticks and a pull in flight + tick",
      { ...pullingA, ticks: PROVISIONED_PULL_TICK_LIMIT },
      tickA(PULL_B),
      { listings: 0, missingSlots: MISSING, status: "abandoned" },
    ],
    [
      "pulling + its pull listed",
      pullingA,
      { listed: true, pull: PULL_A, type: "pull-settled" },
      { ...pullingA, listings: 1, pull: null },
    ],
    [
      "pulling + its pull could not list",
      pullingA,
      { listed: false, pull: PULL_A, type: "pull-settled" },
      { ...pullingA, pull: null },
    ],
    [
      "idle + a cancelled run's pull listed",
      { ...idle, pull: PULL_A },
      { listed: true, pull: PULL_A, type: "pull-settled" },
      { ...idle, listings: 1 },
    ],
    [
      "polling + cancel keeps the pull in flight",
      pullingA,
      { sequence: SEQUENCE_A, type: "cancel" },
      { listings: 0, pull: PULL_A, status: "idle", ticks: 1 },
    ],
    [
      "surfacing + cancel",
      surfacingA,
      { sequence: SEQUENCE_A, type: "cancel" },
      idle,
    ],
  ])("%s", (_label, state, event, next) => {
    expect(transitionProvisionedPull(state, event)).toEqual(next);
  });

  test.each<[string, ProvisionedPullState, ProvisionedPullEvent]>([
    [
      "idle + surfaced",
      idle,
      { missingSlots: [], sequence: SEQUENCE_A, type: "surfaced" },
    ],
    ["idle + tick", idle, tickA(PULL_A)],
    ["idle + cancel", idle, { sequence: SEQUENCE_A, type: "cancel" }],
    [
      "surfacing + another run's surfaced",
      surfacingA,
      { missingSlots: [], sequence: SEQUENCE_B, type: "surfaced" },
    ],
    ["surfacing + tick", surfacingA, tickA(PULL_A)],
    [
      "polling + another run's tick",
      pollingA,
      {
        missingSlots: MISSING,
        pull: PULL_A,
        sequence: SEQUENCE_B,
        type: "tick",
      },
    ],
    [
      "polling + another run's cancel",
      pollingA,
      { sequence: SEQUENCE_B, type: "cancel" },
    ],
    [
      "polling + surfaced",
      pollingA,
      { missingSlots: [], sequence: SEQUENCE_A, type: "surfaced" },
    ],
    [
      "polling + a pull that is not in flight",
      pullingA,
      { listed: true, pull: PULL_B, type: "pull-settled" },
    ],
    ["settled + tick", settled, tickA(PULL_A)],
    [
      "settled + pull-settled",
      settled,
      { listed: true, pull: PULL_A, type: "pull-settled" },
    ],
    [
      "abandoned + pull-settled",
      abandoned,
      { listed: true, pull: PULL_A, type: "pull-settled" },
    ],
    ["abandoned + cancel", abandoned, { sequence: SEQUENCE_A, type: "cancel" }],
  ])("%s is ignored", (_label, state, event) => {
    expect(transitionProvisionedPull(state, event)).toBe(state);
  });

  test("one organization sends at most the listing limit across runs", () => {
    const events: ProvisionedPullEvent[] = [];
    const sequences = [SEQUENCE_A, SEQUENCE_B, { name: "sequence-c" }];
    for (const [index, sequence] of sequences.entries()) {
      const pull = { index };
      events.push(
        { sequence, type: "start" },
        { missingSlots: MISSING, sequence, type: "surfaced" },
        { missingSlots: MISSING, pull, sequence, type: "tick" },
        { listed: true, pull, type: "pull-settled" },
        { sequence, type: "cancel" },
      );
    }
    expect(run(idle, events)).toEqual(abandoned);
  });

  test("a cancelled run's pull in flight holds off the next run's pull", () => {
    const state = run(idle, [
      { sequence: SEQUENCE_A, type: "start" },
      { missingSlots: MISSING, sequence: SEQUENCE_A, type: "surfaced" },
      tickA(PULL_A),
      { sequence: SEQUENCE_A, type: "cancel" },
      { sequence: SEQUENCE_B, type: "start" },
      { missingSlots: MISSING, sequence: SEQUENCE_B, type: "surfaced" },
      {
        missingSlots: MISSING,
        pull: PULL_B,
        sequence: SEQUENCE_B,
        type: "tick",
      },
    ]);
    // Run B's tick only counted: run A's pull is still the one in flight.
    expect(state).toEqual({
      listings: 0,
      pull: PULL_A,
      sequence: SEQUENCE_B,
      status: "polling",
      ticks: 2,
    });
    // Once it settles, run B's next tick starts the second listing.
    expect(
      run(state, [
        { listed: true, pull: PULL_A, type: "pull-settled" },
        {
          missingSlots: MISSING,
          pull: PULL_B,
          sequence: SEQUENCE_B,
          type: "tick",
        },
      ]),
    ).toEqual({
      listings: 1,
      pull: PULL_B,
      sequence: SEQUENCE_B,
      status: "polling",
      ticks: 3,
    });
  });

  test("a pull from before the budget restarted does not settle the new one", () => {
    const state = run(settled, [
      { sequence: SEQUENCE_B, type: "start" },
      { missingSlots: MISSING, sequence: SEQUENCE_B, type: "surfaced" },
      {
        missingSlots: MISSING,
        pull: PULL_B,
        sequence: SEQUENCE_B,
        type: "tick",
      },
      { listed: true, pull: PULL_A, type: "pull-settled" },
    ]);
    expect(state).toEqual({
      listings: 0,
      pull: PULL_B,
      sequence: SEQUENCE_B,
      status: "polling",
      ticks: 1,
    });
  });

  test("ticks whose pulls cannot list still stop the timer", () => {
    let state: ProvisionedPullState = pollingA;
    // Each tick starts a pull the store could not list: nothing was sent.
    for (let tick = 0; tick < PROVISIONED_PULL_TICK_LIMIT; tick += 1) {
      const pull = { tick };
      state = run(state, [
        tickA(pull),
        { listed: false, pull, type: "pull-settled" },
      ]);
    }
    expect(state).toEqual({
      ...pollingA,
      ticks: PROVISIONED_PULL_TICK_LIMIT,
    });
    expect(transitionProvisionedPull(state, tickA(PULL_A))).toEqual({
      listings: 0,
      missingSlots: MISSING,
      status: "abandoned",
    });
  });
});
