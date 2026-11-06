import { describe, expect, test } from "bun:test";
import {
  hasPendingRequest,
  IDLE_SYNC_LANE_RUN,
  isLaneRunning,
  isRequestDue,
  NO_SYNC_LANE_REQUEST,
  ownsLiveRun,
  type SyncLaneRequest,
  type SyncLaneRequestEvent,
  type SyncLaneRun,
  type SyncLaneRunEvent,
  transitionSyncLaneRequest,
  transitionSyncLaneRun,
} from "./syncLaneMachine";

const current = {};
const other = {};

const runStates: Record<SyncLaneRun["status"], SyncLaneRun> = {
  abandoned: { status: "abandoned", token: current },
  backingOff: { status: "backingOff", token: current },
  idle: IDLE_SYNC_LANE_RUN,
  running: { status: "running", token: current },
};

type RunEventType = SyncLaneRunEvent["type"];
type RunOutcome = SyncLaneRun | "same";

// Every state x event with the current tag. A stale tag is tested below.
const runTable: Record<
  SyncLaneRun["status"],
  Record<RunEventType, RunOutcome>
> = {
  abandoned: {
    "back-off": "same",
    "backoff-expire": "same",
    settle: IDLE_SYNC_LANE_RUN,
    start: "same",
    "time-out": "same",
  },
  backingOff: {
    "back-off": "same",
    "backoff-expire": IDLE_SYNC_LANE_RUN,
    settle: "same",
    start: "same",
    "time-out": "same",
  },
  idle: {
    "back-off": { status: "backingOff", token: current },
    "backoff-expire": "same",
    settle: "same",
    start: { status: "running", token: current },
    "time-out": "same",
  },
  running: {
    "back-off": "same",
    "backoff-expire": "same",
    settle: IDLE_SYNC_LANE_RUN,
    start: "same",
    "time-out": { status: "abandoned", token: current },
  },
};

describe("transitionSyncLaneRun", () => {
  for (const [status, row] of Object.entries(runTable)) {
    for (const [type, outcome] of Object.entries(row)) {
      test(`${status} + ${type}`, () => {
        const state = runStates[status as SyncLaneRun["status"]];
        const event = { type, token: current } as SyncLaneRunEvent;
        const next = transitionSyncLaneRun(state, event);
        if (outcome === "same") {
          expect(next).toBe(state);
        } else {
          expect(next).toEqual(outcome);
        }
      });
    }
  }

  test("only the current run, watchdog, or backoff timer may move the run", () => {
    for (const type of ["settle", "time-out", "backoff-expire"] as const) {
      for (const state of Object.values(runStates)) {
        expect(transitionSyncLaneRun(state, { type, token: other })).toBe(
          state,
        );
      }
    }
  });

  test("an abandoned run's late settle cannot finish the run that replaced it", () => {
    const events: SyncLaneRunEvent[] = [
      { type: "start", token: current },
      { type: "time-out", token: current },
      // Selection never starts an abandoned lane; the start is ignored.
      { type: "start", token: other },
      { type: "settle", token: current },
      { type: "start", token: other },
      { type: "settle", token: current },
    ];
    expect(events.reduce(transitionSyncLaneRun, IDLE_SYNC_LANE_RUN)).toEqual({
      status: "running",
      token: other,
    });
  });

  test("a lane runs while its pump run or an upload session is active", () => {
    expect(
      isLaneRunning({ run: IDLE_SYNC_LANE_RUN, uploadSession: null }),
    ).toBe(false);
    expect(isLaneRunning({ run: runStates.running, uploadSession: null })).toBe(
      true,
    );
    expect(
      isLaneRunning({ run: runStates.abandoned, uploadSession: current }),
    ).toBe(true);
  });

  test("a live run is running or abandoned", () => {
    expect(
      Object.values(runStates)
        .filter(ownsLiveRun)
        .map(({ status }) => status)
        .sort(),
    ).toEqual(["abandoned", "running"]);
  });
});

const queued: SyncLaneRequest = { status: "queued" };
const delayed: SyncLaneRequest = { status: "delayed", notBeforeAtMs: 100 };

describe("transitionSyncLaneRequest", () => {
  test.each<[SyncLaneRequest, SyncLaneRequestEvent, SyncLaneRequest | "same"]>([
    [NO_SYNC_LANE_REQUEST, { type: "request" }, queued],
    [queued, { type: "request" }, "same"],
    [delayed, { type: "request" }, queued],
    [
      NO_SYNC_LANE_REQUEST,
      { type: "request-after", notBeforeAtMs: 100 },
      delayed,
    ],
    [queued, { type: "request-after", notBeforeAtMs: 100 }, "same"],
    [delayed, { type: "request-after", notBeforeAtMs: 150 }, "same"],
    [delayed, { type: "request-after", notBeforeAtMs: 100 }, "same"],
    [
      delayed,
      { type: "request-after", notBeforeAtMs: 50 },
      { status: "delayed", notBeforeAtMs: 50 },
    ],
    [
      NO_SYNC_LANE_REQUEST,
      { type: "delay-elapse", notBeforeAtMs: 100 },
      "same",
    ],
    [queued, { type: "delay-elapse", notBeforeAtMs: 100 }, "same"],
    [delayed, { type: "delay-elapse", notBeforeAtMs: 100 }, queued],
    [delayed, { type: "delay-elapse", notBeforeAtMs: 150 }, "same"],
    [NO_SYNC_LANE_REQUEST, { type: "clear" }, "same"],
    [queued, { type: "clear" }, NO_SYNC_LANE_REQUEST],
    [delayed, { type: "clear" }, NO_SYNC_LANE_REQUEST],
  ])("%o + %o", (state, event, outcome) => {
    const next = transitionSyncLaneRequest(state, event);
    if (outcome === "same") {
      expect(next).toBe(state);
    } else {
      expect(next).toEqual(outcome);
    }
  });

  test("a superseded delay timer cannot release an earlier delay", () => {
    const events: SyncLaneRequestEvent[] = [
      { type: "request-after", notBeforeAtMs: 100 },
      { type: "request-after", notBeforeAtMs: 50 },
      { type: "delay-elapse", notBeforeAtMs: 100 },
    ];
    expect(
      events.reduce(transitionSyncLaneRequest, NO_SYNC_LANE_REQUEST),
    ).toEqual({ status: "delayed", notBeforeAtMs: 50 });
  });

  test("a request is pending until cleared and due once its delay passes", () => {
    expect(hasPendingRequest(NO_SYNC_LANE_REQUEST)).toBe(false);
    expect(hasPendingRequest(queued)).toBe(true);
    expect(hasPendingRequest(delayed)).toBe(true);
    expect(isRequestDue(NO_SYNC_LANE_REQUEST, 1_000)).toBe(false);
    expect(isRequestDue(queued, 0)).toBe(true);
    expect(isRequestDue(delayed, 99)).toBe(false);
    expect(isRequestDue(delayed, 100)).toBe(true);
  });
});
