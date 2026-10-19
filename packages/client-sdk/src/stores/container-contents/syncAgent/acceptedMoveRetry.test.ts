import { expect, test } from "bun:test";
import type { ContainerContentsSyncLane } from "../../../workflows/container-contents/syncLane";
import { createAcceptedMoveRetry } from "./acceptedMoveRetry";

function laneRecording(delays: number[]): ContainerContentsSyncLane {
  return {
    isDisposed: () => false,
    requestSync: () => {},
    requestSyncAfter: (delayMs) => {
      delays.push(delayMs);
    },
  };
}

test("an accepted move re-arms the lane a bounded number of times", () => {
  const delays: number[] = [];
  const state = { syncLane: laneRecording(delays) };
  for (let pass = 0; pass < 5; pass += 1) {
    createAcceptedMoveRetry(state).arm("intent-a");
  }
  expect(delays).toEqual([1_000, 5_000, 30_000]);
});

test("a later failed replay resumes only an accepted move's budget", () => {
  const delays: number[] = [];
  const state = { syncLane: laneRecording(delays) };
  // A move that was never accepted retries only on its usual triggers.
  createAcceptedMoveRetry(state).resume("intent-b");
  createAcceptedMoveRetry(state).arm("intent-a");
  // The re-armed replay fails before reaching the server.
  createAcceptedMoveRetry(state).resume("intent-a");
  expect(delays).toEqual([1_000, 5_000]);
});

test("one pass schedules an intent once and budgets intents separately", () => {
  const delays: number[] = [];
  const retry = createAcceptedMoveRetry({ syncLane: laneRecording(delays) });
  retry.arm("intent-a");
  retry.resume("intent-a");
  retry.arm("intent-b");
  expect(delays).toEqual([1_000, 1_000]);
});
