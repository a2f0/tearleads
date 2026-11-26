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

const pending = (
  status: "awaitingCrawl" | "awaitingTurn",
  current: CatchUpWait,
  opened: ReadonlyArray<string> = [],
): CatchUpState => ({
  openedContainerIds: new Set(opened),
  status,
  wait: current,
});
const awaiting = (current: CatchUpWait, opened: ReadonlyArray<string> = []) =>
  pending("awaitingCrawl", current, opened);

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

test("a settled crawl leaves the catch-up awaiting its turn", () => {
  const current = wait();
  const state = awaiting(current, ["opened"]);

  // Another wait's crawl says nothing about this one.
  expect(transitionCatchUp(state, { type: "crawlSettled", wait: wait() })).toBe(
    state,
  );
  expect(
    transitionCatchUp(state, { type: "crawlSettled", wait: current }),
  ).toEqual(pending("awaitingTurn", current, ["opened"]));
  expect(
    transitionCatchUp(IDLE_CATCH_UP, { type: "crawlSettled", wait: current }),
  ).toBe(IDLE_CATCH_UP);
});

test("an acknowledgement while a catch-up awaits its turn starts its own wait", () => {
  const earlier = wait();
  const later = wait();
  const state = transitionCatchUp(
    pending("awaitingTurn", earlier, ["opened"]),
    { type: "acknowledged", wait: later },
  );

  // The earlier crawl settled before this acknowledgement.
  expect(state).toEqual(awaiting(later, ["opened"]));
  // The earlier catch-up's turn does not end the later one's deferral.
  expect(transitionCatchUp(state, { type: "turnTaken", wait: earlier })).toBe(
    state,
  );
});

test("only the catch-up in progress ends by taking its turn", () => {
  const current = wait();
  for (const status of ["awaitingCrawl", "awaitingTurn"] as const) {
    const state = pending(status, current);
    expect(transitionCatchUp(state, { type: "turnTaken", wait: wait() })).toBe(
      state,
    );
    expect(transitionCatchUp(state, { type: "turnTaken", wait: current })).toBe(
      IDLE_CATCH_UP,
    );
  }
  expect(
    transitionCatchUp(IDLE_CATCH_UP, { type: "turnTaken", wait: current }),
  ).toBe(IDLE_CATCH_UP);
});

test("a stop ends any catch-up", () => {
  for (const status of ["awaitingCrawl", "awaitingTurn"] as const) {
    expect(
      transitionCatchUp(pending(status, wait()), { type: "stopped" }),
    ).toBe(IDLE_CATCH_UP);
  }
  expect(transitionCatchUp(IDLE_CATCH_UP, { type: "stopped" })).toBe(
    IDLE_CATCH_UP,
  );
});

test("a container opened before the turn is remembered until then", () => {
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

test("a queued lane defers to a pending catch-up unless it was opened", () => {
  for (const status of ["awaitingCrawl", "awaitingTurn"] as const) {
    const state = pending(status, wait(["known"]), ["opened"]);
    expect(defersQueuedLane(state, "known")).toBe(true);
    // The sweep lists a lane found since in one batch with the others.
    expect(defersQueuedLane(state, "found-since")).toBe(true);
    expect(defersQueuedLane(state, "opened")).toBe(false);
  }
  expect(defersQueuedLane(IDLE_CATCH_UP, "known")).toBe(false);
});

test("a root sweep leaves the lanes known at the acknowledgement", () => {
  for (const status of ["awaitingCrawl", "awaitingTurn"] as const) {
    const state = pending(status, wait(["known", "opened"]), ["opened"]);
    expect(defersRootSweepLane(state, "known")).toBe(true);
    // A lane found since was never part of what the crawl is asked about.
    expect(defersRootSweepLane(state, "found-since")).toBe(false);
    expect(defersRootSweepLane(state, "opened")).toBe(false);
  }
  expect(defersRootSweepLane(IDLE_CATCH_UP, "known")).toBe(false);
});
