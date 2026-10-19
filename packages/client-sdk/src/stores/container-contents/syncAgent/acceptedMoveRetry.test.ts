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
    createAcceptedMoveRetry(state)("intent-a");
  }
  expect(delays).toEqual([1_000, 5_000, 30_000]);
});

test("each intent has its own retry budget", () => {
  const delays: number[] = [];
  const retry = createAcceptedMoveRetry({ syncLane: laneRecording(delays) });
  retry("intent-a");
  retry("intent-b");
  retry("intent-a");
  expect(delays).toEqual([1_000, 1_000, 5_000]);
});
