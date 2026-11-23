import { expect, test } from "bun:test";
import {
  IDLE_QUEUE_READ_LOOP,
  type QueueReadLoopEvent,
  type QueueReadLoopState,
  transitionQueueReadLoop,
} from "./queueReadLoopMachine";

function run(
  events: ReadonlyArray<QueueReadLoopEvent>,
  from: QueueReadLoopState = IDLE_QUEUE_READ_LOOP,
): QueueReadLoopState {
  return events.reduce(transitionQueueReadLoop, from);
}

const now = { immediate: true, type: "requested" } as const;
const later = { immediate: false, type: "requested" } as const;

test("an immediate request reads at once and a later one waits", () => {
  expect(run([now])).toEqual({ reads: 1, rerun: "none", status: "reading" });
  const waiting = run([later]);
  expect(waiting).toEqual({ reads: 0, status: "waiting" });
  expect(transitionQueueReadLoop(waiting, later)).toBe(waiting);
  expect(run([{ type: "delay-elapsed" }], waiting)).toEqual({
    reads: 1,
    rerun: "none",
    status: "reading",
  });
  // Opening a view or Refresh skips the remaining delay.
  expect(run([now], waiting)).toMatchObject({ reads: 1, status: "reading" });
});

test("requests during a read coalesce into one follow-up", () => {
  const soon = run([now, later]);
  expect(soon).toEqual({ reads: 1, rerun: "soon", status: "reading" });
  expect(transitionQueueReadLoop(soon, later)).toBe(soon);
  expect(run([{ type: "read-settled", watched: true }], soon)).toEqual({
    reads: 1,
    status: "waiting",
  });
  // An opened view or Refresh mid-read gets its read straight after.
  const immediate = run([later, now], run([now]));
  expect(immediate).toEqual({ reads: 1, rerun: "now", status: "reading" });
  expect(transitionQueueReadLoop(immediate, later)).toBe(immediate);
  expect(run([{ type: "read-settled", watched: true }], immediate)).toEqual({
    reads: 2,
    rerun: "none",
    status: "reading",
  });
  expect(run([{ type: "read-settled", watched: true }], run([now]))).toEqual({
    reads: 1,
    status: "idle",
  });
});

test("an unwatched store drops its follow-ups but finishes its read", () => {
  expect(run([{ type: "unwatched" }], run([later]))).toEqual({
    reads: 0,
    status: "idle",
  });
  expect(run([{ type: "unwatched" }], run([now, now]))).toEqual({
    reads: 1,
    rerun: "none",
    status: "reading",
  });
  expect(
    run([{ type: "read-settled", watched: false }], run([now, now])),
  ).toEqual({ reads: 1, status: "idle" });
  // Stray events leave a settled loop alone.
  expect(
    transitionQueueReadLoop(IDLE_QUEUE_READ_LOOP, {
      type: "delay-elapsed",
    }),
  ).toBe(IDLE_QUEUE_READ_LOOP);
  expect(
    transitionQueueReadLoop(IDLE_QUEUE_READ_LOOP, {
      type: "read-settled",
      watched: true,
    }),
  ).toBe(IDLE_QUEUE_READ_LOOP);
  expect(
    transitionQueueReadLoop(IDLE_QUEUE_READ_LOOP, { type: "unwatched" }),
  ).toBe(IDLE_QUEUE_READ_LOOP);
});
