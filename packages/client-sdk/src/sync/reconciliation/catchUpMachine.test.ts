import { expect, test } from "bun:test";
import {
  type CatchUpState,
  type CatchUpWait,
  defersToCatchUp,
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
  listedNowContainerIds: new Set(opened),
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
  for (const before of [
    pending("awaitingTurn", earlier, ["opened"]),
    { status: "overdue", wait: earlier } as const,
  ]) {
    const state = transitionCatchUp(before, {
      type: "acknowledged",
      wait: later,
    });

    // The earlier crawl settled before this acknowledgement, and what was
    // listed at once then says nothing about what moved since.
    expect(state).toEqual(awaiting(later));
    // The earlier catch-up's turn does not end the later one's deferral.
    expect(transitionCatchUp(state, { type: "turnTaken", wait: earlier })).toBe(
      state,
    );
  }
});

test("a turn that does not come in time makes the catch-up overdue", () => {
  const current = wait(["known"]);
  const state = pending("awaitingTurn", current, ["opened"]);
  const overdue = transitionCatchUp(state, {
    type: "turnOverdue",
    wait: current,
  });

  expect(overdue).toEqual({ status: "overdue", wait: current });
  // Nothing waits for an overdue catch-up, and nothing changes that but
  // its turn, a new acknowledgement or a stop.
  expect(defersToCatchUp(overdue, "known")).toBe(false);
  for (const event of [
    { type: "crawlSettled", wait: current },
    { type: "turnOverdue", wait: current },
    { containerId: "known", type: "opened" },
    { containerIds: ["known"], type: "alreadyOwed", wait: current },
    { type: "turnTaken", wait: wait() },
  ] as const) {
    expect(transitionCatchUp(overdue, event)).toBe(overdue);
  }
  expect(transitionCatchUp(overdue, { type: "turnTaken", wait: current })).toBe(
    IDLE_CATCH_UP,
  );

  // Only a settled crawl's wait for its turn becomes overdue, and only its own.
  expect(
    transitionCatchUp(awaiting(current), {
      type: "turnOverdue",
      wait: current,
    }),
  ).toEqual(awaiting(current));
  expect(transitionCatchUp(state, { type: "turnOverdue", wait: wait() })).toBe(
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
  expect(
    transitionCatchUp({ status: "overdue", wait: wait() }, { type: "stopped" }),
  ).toBe(IDLE_CATCH_UP);
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

test("a lane known at the acknowledgement defers to a pending catch-up", () => {
  for (const status of ["awaitingCrawl", "awaitingTurn"] as const) {
    const state = pending(status, wait(["known", "opened"]), ["opened"]);
    expect(defersToCatchUp(state, "known")).toBe(true);
    // A lane found since was never listed: no crawl can vouch for it.
    expect(defersToCatchUp(state, "found-since")).toBe(false);
    expect(defersToCatchUp(state, "opened")).toBe(false);
  }
  expect(defersToCatchUp(IDLE_CATCH_UP, "known")).toBe(false);
});

test("lanes already owed at the acknowledgement are listed without waiting", () => {
  const current = wait(["owed", "settled"]);
  const state = transitionCatchUp(awaiting(current), {
    containerIds: ["owed"],
    type: "alreadyOwed",
    wait: current,
  });

  expect(defersToCatchUp(state, "owed")).toBe(false);
  expect(defersToCatchUp(state, "settled")).toBe(true);
  // What an older wait read is about another acknowledgement.
  expect(
    transitionCatchUp(state, {
      containerIds: ["settled"],
      type: "alreadyOwed",
      wait: wait(),
    }),
  ).toBe(state);
  // Nothing new to list now leaves the state as it is.
  expect(
    transitionCatchUp(state, {
      containerIds: ["owed"],
      type: "alreadyOwed",
      wait: current,
    }),
  ).toBe(state);
});
