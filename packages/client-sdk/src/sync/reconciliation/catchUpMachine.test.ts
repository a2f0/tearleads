import { expect, test } from "bun:test";
import {
  type CatchUpState,
  type CatchUpWait,
  defersToCatchUp,
  IDLE_CATCH_UP,
  listedSinceAcknowledgement,
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
  listed: ReadonlyArray<string> = [],
  acknowledgements = 1,
  pendingGenerations: ReadonlyMap<string, number> = new Map(),
): CatchUpState => ({
  acknowledgements,
  listedNowContainerIds: new Set(opened),
  listedSinceContainerIds: new Set(listed),
  pendingGenerations,
  status,
  wait: current,
});
const overdueFor = (
  current: CatchUpWait,
  listed: ReadonlyArray<string> = [],
  pendingGenerations: ReadonlyMap<string, number> = new Map(),
): CatchUpState => ({
  acknowledgements: 1,
  listedSinceContainerIds: new Set(listed),
  pendingGenerations,
  status: "overdue",
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

  // The second keeps the wait and what is listed now, and starts the record
  // of listings again: one sent before it may have missed a write.
  const shared = transitionCatchUp(
    pending("awaitingCrawl", first, ["opened"], ["listed"]),
    { type: "acknowledged", wait: wait() },
  );
  expect(shared).toEqual(pending("awaitingCrawl", first, ["opened"], [], 2));
  // A listing sent before it, answered after it, does not count either.
  const listedA = {
    containerIds: ["a"],
    pendingGenerations: new Map<string, number>(),
    type: "listed",
    wait: first,
  } as const;
  expect(transitionCatchUp(shared, { ...listedA, acknowledgements: 1 })).toBe(
    shared,
  );
  expect(
    listedSinceAcknowledgement(
      transitionCatchUp(shared, { ...listedA, acknowledgements: 2 }),
      first,
    ),
  ).toEqual(new Set(["a"]));
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
    pending("awaitingTurn", earlier, ["opened"], ["listed"]),
    overdueFor(earlier, ["listed"]),
  ]) {
    const state = transitionCatchUp(before, {
      type: "acknowledged",
      wait: later,
    });

    // The earlier crawl settled before this acknowledgement, and what was
    // listed then says nothing about what moved since.
    expect(state).toEqual(awaiting(later));
    // The earlier catch-up's turn does not end the later one's deferral.
    expect(transitionCatchUp(state, { type: "turnTaken", wait: earlier })).toBe(
      state,
    );
  }
});

test("a turn that does not come in time makes the catch-up overdue", () => {
  const current = wait(["known"]);
  const state = pending("awaitingTurn", current, ["opened"], ["listed"]);
  const overdue = transitionCatchUp(state, {
    type: "turnOverdue",
    wait: current,
  });

  expect(overdue).toEqual(overdueFor(current, ["listed"]));
  // Nothing waits for an overdue catch-up, and nothing changes that but
  // its turn, a listing, a pending retry, a new acknowledgement or a stop.
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
  expect(transitionCatchUp(overdueFor(wait()), { type: "stopped" })).toBe(
    IDLE_CATCH_UP,
  );
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

test("a lane listed after the acknowledgement is kept until the turn", () => {
  const current = wait(["a", "b"]);
  const listedA = {
    acknowledgements: 1,
    containerIds: ["a"],
    pendingGenerations: new Map<string, number>(),
    type: "listed",
    wait: current,
  } as const;
  for (const before of [
    pending("awaitingCrawl", current),
    pending("awaitingTurn", current),
    overdueFor(current),
  ]) {
    const state = transitionCatchUp(before, listedA);

    expect(listedSinceAcknowledgement(state, current)).toEqual(new Set(["a"]));
    // It changes what the catch-up lists, not what waits for it.
    expect(state.status).toBe(before.status);
    expect(defersToCatchUp(state, "a")).toBe(defersToCatchUp(before, "a"));
    // Listed again, or by a request sent for another wait: no change.
    expect(transitionCatchUp(state, listedA)).toBe(state);
    expect(
      transitionCatchUp(state, {
        ...listedA,
        containerIds: ["b"],
        wait: wait(),
      }),
    ).toBe(state);
    expect(listedSinceAcknowledgement(state, wait())).toEqual(new Set());
  }

  // The set outlasts the crawl and an overdue turn, and idle keeps none.
  const settled = transitionCatchUp(
    transitionCatchUp(pending("awaitingCrawl", current), listedA),
    { type: "crawlSettled", wait: current },
  );
  const overdue = transitionCatchUp(settled, {
    type: "turnOverdue",
    wait: current,
  });
  expect(listedSinceAcknowledgement(overdue, current)).toEqual(new Set(["a"]));
  expect(transitionCatchUp(IDLE_CATCH_UP, listedA)).toBe(IDLE_CATCH_UP);
  expect(listedSinceAcknowledgement(IDLE_CATCH_UP, current)).toEqual(new Set());
});

test("pending discovery drops a lane and blocks older in-flight listings from re-adding it", () => {
  const current = wait(["a", "b"]);
  const olderSnapshot = new Map<string, number>();
  for (const before of [
    pending("awaitingCrawl", current, [], ["a", "b"]),
    pending("awaitingTurn", current, [], ["a", "b"]),
    overdueFor(current, ["a", "b"]),
  ]) {
    const after = transitionCatchUp(before, {
      containerId: "a",
      type: "pendingDiscovery",
    });
    expect(listedSinceAcknowledgement(after, current)).toEqual(new Set(["b"]));
    // An older listing started before pendingDiscovery cannot re-add "a",
    // while still recording unaffected lanes such as "c".
    const afterStaleList = transitionCatchUp(after, {
      acknowledgements: 1,
      containerIds: ["a", "c"],
      pendingGenerations: olderSnapshot,
      type: "listed",
      wait: current,
    });
    expect(listedSinceAcknowledgement(afterStaleList, current)).toEqual(
      new Set(["b", "c"]),
    );
    // A clean listing started after pendingDiscovery carries the raised
    // generation and can add "a" again.
    if (afterStaleList.status === "idle") {
      throw new Error("Expected active catch-up state");
    }
    const afterFreshList = transitionCatchUp(afterStaleList, {
      acknowledgements: 1,
      containerIds: ["a"],
      pendingGenerations: afterStaleList.pendingGenerations,
      type: "listed",
      wait: current,
    });
    expect(listedSinceAcknowledgement(afterFreshList, current)).toEqual(
      new Set(["a", "b", "c"]),
    );
  }
  expect(
    transitionCatchUp(IDLE_CATCH_UP, {
      containerId: "a",
      type: "pendingDiscovery",
    }),
  ).toBe(IDLE_CATCH_UP);
});
