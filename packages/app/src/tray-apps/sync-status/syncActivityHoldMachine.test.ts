import { expect, test } from "bun:test";
import {
  IDLE_SYNC_ACTIVITY_HOLD,
  type SyncActivityHoldEvent,
  type SyncActivityHoldState,
  showsSyncActivity,
  transitionSyncActivityHold,
} from "./syncActivityHoldMachine";

const on = { active: true, type: "activity-changed" } as const;
const off = { active: false, type: "activity-changed" } as const;
const elapsed = { type: "delay-elapsed" } as const;

function run(
  events: ReadonlyArray<SyncActivityHoldEvent>,
  from: SyncActivityHoldState = IDLE_SYNC_ACTIVITY_HOLD,
): SyncActivityHoldState {
  return events.reduce(transitionSyncActivityHold, from);
}

test("activity shows only once it outlasts the enter delay", () => {
  expect(run([on])).toEqual({ status: "entering" });
  expect(showsSyncActivity(run([on]))).toBe(false);
  // A run that settles within the delay never shows.
  expect(run([on, off])).toBe(IDLE_SYNC_ACTIVITY_HOLD);
  expect(run([on, elapsed])).toEqual({ status: "active" });
  expect(showsSyncActivity(run([on, elapsed]))).toBe(true);
});

test("activity stays shown through a short gap between runs", () => {
  const leaving = run([on, elapsed, off]);
  expect(leaving).toEqual({ status: "leaving" });
  expect(showsSyncActivity(leaving)).toBe(true);
  expect(run([on], leaving)).toEqual({ status: "active" });
  expect(run([elapsed], leaving)).toBe(IDLE_SYNC_ACTIVITY_HOLD);
});

test("repeated and stray events leave the state alone", () => {
  const entering = run([on]);
  expect(transitionSyncActivityHold(entering, on)).toBe(entering);
  const active = run([on, elapsed]);
  expect(transitionSyncActivityHold(active, on)).toBe(active);
  expect(transitionSyncActivityHold(active, elapsed)).toBe(active);
  const leaving = run([off], active);
  expect(transitionSyncActivityHold(leaving, off)).toBe(leaving);
  expect(transitionSyncActivityHold(IDLE_SYNC_ACTIVITY_HOLD, off)).toBe(
    IDLE_SYNC_ACTIVITY_HOLD,
  );
  expect(transitionSyncActivityHold(IDLE_SYNC_ACTIVITY_HOLD, elapsed)).toBe(
    IDLE_SYNC_ACTIVITY_HOLD,
  );
});
