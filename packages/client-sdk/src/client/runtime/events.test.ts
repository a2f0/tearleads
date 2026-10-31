import { expect, test } from "bun:test";
import { Events } from "./events";

test("invalidating access state drops caches through the owning client", () => {
  let invalidations = 0;
  const events = new Events([], () => {
    invalidations += 1;
  });

  events.invalidateAccessState();
  events.invalidateAccessState();

  expect(invalidations).toBe(2);
});

test("a connect attempt stays pending until acknowledged, ended, or disconnected", () => {
  const events = new Events();
  let notifications = 0;
  events.subscribe(() => {
    notifications += 1;
  });
  expect(events.pendingConnectAttempt).toBeUndefined();

  const first = events.beginConnectAttempt();
  expect(events.pendingConnectAttempt).toBe(first);
  // The acknowledgement clears it and advances the generation.
  events.setConnected(true);
  expect(events.pendingConnectAttempt).toBeUndefined();
  expect(events.connectionGeneration).toBe(1);

  events.setConnected(false);
  const second = events.beginConnectAttempt();
  expect(second).toBeGreaterThan(first);
  // A stale attempt cannot end the current one.
  events.endConnectAttempt(first);
  expect(events.pendingConnectAttempt).toBe(second);
  events.endConnectAttempt(second);
  expect(events.pendingConnectAttempt).toBeUndefined();

  const third = events.beginConnectAttempt();
  // A disconnect while already disconnected still ends the attempt.
  events.setConnected(false);
  expect(events.pendingConnectAttempt).toBeUndefined();
  expect(third).toBeGreaterThan(second);
  expect(events.connectionGeneration).toBe(1);
  expect(notifications).toBe(7);
});
