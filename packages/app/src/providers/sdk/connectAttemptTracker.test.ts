import { expect, test } from "bun:test";
import { Events } from "@tearleads/client-sdk";
import {
  CONNECT_ACKNOWLEDGEMENT_TIMEOUT_MS,
  trackConnectAttempts,
} from "./connectAttemptTracker";

function fakeTimers() {
  const scheduled = new Map<
    number,
    { callback: () => void; delayMs: number }
  >();
  let nextId = 0;
  return {
    scheduled,
    timers: {
      clear: (timer: ReturnType<typeof setTimeout>) => {
        scheduled.delete(Number(timer));
      },
      schedule: (callback: () => void, delayMs: number) => {
        nextId += 1;
        scheduled.set(nextId, { callback, delayMs });
        return nextId as unknown as ReturnType<typeof setTimeout>;
      },
    },
    fireAll: () => {
      for (const [id, entry] of [...scheduled]) {
        scheduled.delete(id);
        entry.callback();
      }
    },
  };
}

test("a declaration whose acknowledgement never arrives releases the deferral", () => {
  const events = new Events();
  const clock = fakeTimers();
  const attempts = trackConnectAttempts(events, clock.timers);

  attempts.begin();
  expect(events.pendingConnectAttempt).toBe(1);
  attempts.awaitAcknowledgement();
  expect([...clock.scheduled.values()].map((entry) => entry.delayMs)).toEqual([
    CONNECT_ACKNOWLEDGEMENT_TIMEOUT_MS,
  ]);

  // The server holds the acknowledgement past the deadline.
  clock.fireAll();
  expect(events.pendingConnectAttempt).toBeUndefined();
});

test("an acknowledged attempt is not ended by its stale deadline", () => {
  const events = new Events();
  const clock = fakeTimers();
  const attempts = trackConnectAttempts(events, clock.timers);

  attempts.begin();
  attempts.awaitAcknowledgement();
  events.setConnected(true);
  expect(events.connectionGeneration).toBe(1);

  // A reconnect starts a new attempt and cancels the earlier deadline.
  events.setConnected(false);
  attempts.begin();
  expect(clock.scheduled.size).toBe(0);
  expect(events.pendingConnectAttempt).toBe(2);
  clock.fireAll();
  expect(events.pendingConnectAttempt).toBe(2);

  // Teardown ends the attempt the loop left pending.
  attempts.endingWith(() => undefined)();
  expect(events.pendingConnectAttempt).toBeUndefined();
});
