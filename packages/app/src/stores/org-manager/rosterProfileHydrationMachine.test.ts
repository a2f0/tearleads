import { expect, test } from "bun:test";
import type { RosterProfileBinding } from "./rosterProfileDisplayNames";
import {
  initialRosterProfileHydration,
  type RosterProfileHydration,
  type RosterProfileHydrationEvent,
  transitionRosterProfileHydration,
} from "./rosterProfileHydrationMachine";

const binding = (id: string) =>
  ({ canonicalLocalId: id, profileDocumentId: id }) as RosterProfileBinding;
const first = [binding("a"), binding("b")];
const latest = [binding("b")];

function run(
  state: RosterProfileHydration,
  ...events: RosterProfileHydrationEvent[]
): RosterProfileHydration {
  return events.reduce(transitionRosterProfileHydration, state);
}

test("a member's load never pulls", () => {
  const state = initialRosterProfileHydration(false);
  expect(state).toEqual({ status: "disabled" });
  expect(
    run(
      state,
      { type: "profilesMissing", bindings: first },
      { type: "containersChanged" },
    ),
  ).toEqual(state);
});

test("an admin's load pulls once, then ignores later events", () => {
  const running = run(initialRosterProfileHydration(true), {
    type: "profilesMissing",
    bindings: first,
  });
  expect(running).toEqual({
    status: "running",
    attempt: 0,
    bindings: first,
    containersChanged: false,
  });
  expect(run(running, { type: "profilesMissing", bindings: latest })).toEqual(
    running,
  );
  const done = run(running, { type: "finished" });
  expect(done).toEqual({ status: "done" });
  expect(
    run(
      done,
      { type: "profilesMissing", bindings: latest },
      { type: "containersChanged" },
      { type: "containerMissing" },
    ),
  ).toEqual(done);
});

test("nothing missing leaves the load idle", () => {
  const idle = initialRosterProfileHydration(true);
  expect(run(idle, { type: "profilesMissing", bindings: [] })).toEqual(idle);
  expect(run(idle, { type: "containersChanged" })).toEqual(idle);
});

test("a missing container waits for the listing, keeping the latest profiles", () => {
  const waiting = run(
    initialRosterProfileHydration(true),
    { type: "profilesMissing", bindings: first },
    { type: "containerMissing" },
  );
  expect(waiting).toEqual({ status: "awaitingContainer", bindings: first });
  const updated = run(waiting, { type: "profilesMissing", bindings: latest });
  expect(updated).toEqual({ status: "awaitingContainer", bindings: latest });
  expect(run(updated, { type: "containersChanged" })).toEqual({
    status: "running",
    attempt: 0,
    bindings: latest,
    containersChanged: false,
  });
});

test("a listing change during a pass that found no container retries at once", () => {
  const running = run(initialRosterProfileHydration(true), {
    type: "profilesMissing",
    bindings: first,
  });
  expect(
    run(running, { type: "containersChanged" }, { type: "containerMissing" }),
  ).toEqual({
    status: "running",
    attempt: 1,
    bindings: first,
    containersChanged: false,
  });
  // A change during a pass that then finishes needs nothing more.
  expect(
    run(running, { type: "containersChanged" }, { type: "finished" }),
  ).toEqual({ status: "done" });
});
