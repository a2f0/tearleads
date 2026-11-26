import { expect, test } from "bun:test";
import {
  type CatchUpState,
  type CatchUpWait,
  defersQueuedLane,
  defersRootSweepLane,
  IDLE_CATCH_UP,
  transitionCatchUp,
} from "./catchUpMachine";

function wait(known: ReadonlyArray<string> = []): CatchUpWait {
  return {
    cancel: () => undefined,
    knownContainerIds: new Set(known),
    promise: Promise.resolve(),
  };
}

const awaiting = (
  current: CatchUpWait,
  opened: ReadonlyArray<string> = [],
): CatchUpState => ({
  openedContainerIds: new Set(opened),
  status: "awaitingCrawl",
  wait: current,
});

test("an acknowledgement starts a wait, and a second one shares it", () => {
  const first = wait();
  const state = transitionCatchUp(IDLE_CATCH_UP, {
    type: "acknowledged",
    wait: first,
  });
  expect(state).toEqual(awaiting(first));

  expect(transitionCatchUp(state, { type: "acknowledged", wait: wait() })).toBe(
    state,
  );
});

test("only the wait in progress ends it", () => {
  const current = wait();
  const state = awaiting(current);

  expect(transitionCatchUp(state, { type: "waitEnded", wait: wait() })).toBe(
    state,
  );
  expect(transitionCatchUp(state, { type: "waitEnded", wait: current })).toBe(
    IDLE_CATCH_UP,
  );
  expect(
    transitionCatchUp(IDLE_CATCH_UP, { type: "waitEnded", wait: current }),
  ).toBe(IDLE_CATCH_UP);
});

test("a stop ends any wait", () => {
  expect(transitionCatchUp(awaiting(wait()), { type: "stopped" })).toBe(
    IDLE_CATCH_UP,
  );
  expect(transitionCatchUp(IDLE_CATCH_UP, { type: "stopped" })).toBe(
    IDLE_CATCH_UP,
  );
});

test("a container opened during the wait is remembered until it ends", () => {
  const current = wait(["known"]);
  const opened = transitionCatchUp(awaiting(current), {
    containerId: "known",
    type: "opened",
  });

  expect(opened).toEqual(awaiting(current, ["known"]));
  // Opening it again changes nothing.
  expect(
    transitionCatchUp(opened, { containerId: "known", type: "opened" }),
  ).toBe(opened);
  expect(
    transitionCatchUp(IDLE_CATCH_UP, { containerId: "known", type: "opened" }),
  ).toBe(IDLE_CATCH_UP);
});

test("a queued lane defers to the waiting catch-up unless it was opened", () => {
  const state = awaiting(wait(["known"]), ["opened"]);

  expect(defersQueuedLane(state, "known")).toBe(true);
  // The sweep lists a lane found since in one batch with the others.
  expect(defersQueuedLane(state, "found-since")).toBe(true);
  expect(defersQueuedLane(state, "opened")).toBe(false);
  expect(defersQueuedLane(IDLE_CATCH_UP, "known")).toBe(false);
});

test("a root sweep leaves the lanes known at the acknowledgement", () => {
  const state = awaiting(wait(["known", "opened"]), ["opened"]);

  expect(defersRootSweepLane(state, "known")).toBe(true);
  // A lane found since was never part of what the crawl is asked about.
  expect(defersRootSweepLane(state, "found-since")).toBe(false);
  expect(defersRootSweepLane(state, "opened")).toBe(false);
  expect(defersRootSweepLane(IDLE_CATCH_UP, "known")).toBe(false);
});
