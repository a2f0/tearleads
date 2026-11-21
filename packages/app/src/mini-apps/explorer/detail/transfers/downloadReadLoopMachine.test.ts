import { expect, test } from "bun:test";
import {
  type DownloadReadLoopEvent,
  type DownloadReadLoopState,
  IDLE_DOWNLOAD_READ_LOOP,
  transitionDownloadReadLoop,
} from "./downloadReadLoopMachine";

function run(
  events: ReadonlyArray<DownloadReadLoopEvent>,
  from: DownloadReadLoopState = IDLE_DOWNLOAD_READ_LOOP,
): DownloadReadLoopState {
  return events.reduce(transitionDownloadReadLoop, from);
}

test("an immediate request reads at once and a later one waits", () => {
  expect(run([{ immediate: true, type: "requested" }])).toEqual({
    rerun: false,
    status: "reading",
  });
  const waiting = run([{ immediate: false, type: "requested" }]);
  expect(waiting).toEqual({ status: "waiting" });
  expect(
    transitionDownloadReadLoop(waiting, {
      immediate: false,
      type: "requested",
    }),
  ).toBe(waiting);
  expect(run([{ type: "delay-elapsed" }], waiting)).toMatchObject({
    status: "reading",
  });
  // Opening a view or Refresh skips the remaining delay.
  expect(run([{ immediate: true, type: "requested" }], waiting)).toMatchObject({
    status: "reading",
  });
});

test("requests during a read coalesce into one follow-up", () => {
  const reading = run([
    { immediate: true, type: "requested" },
    { immediate: false, type: "requested" },
    { immediate: true, type: "requested" },
  ]);
  expect(reading).toEqual({ rerun: true, status: "reading" });
  expect(run([{ type: "read-settled", watched: true }], reading)).toEqual({
    status: "waiting",
  });
  expect(
    run([{ type: "read-settled", watched: true }], {
      rerun: false,
      status: "reading",
    }),
  ).toEqual({ status: "idle" });
});

test("an unwatched store drops its follow-ups but finishes its read", () => {
  expect(run([{ type: "unwatched" }], { status: "waiting" })).toEqual({
    status: "idle",
  });
  const reading = run([{ type: "unwatched" }], {
    rerun: true,
    status: "reading",
  });
  expect(reading).toEqual({ rerun: false, status: "reading" });
  expect(
    run([{ type: "read-settled", watched: false }], {
      rerun: true,
      status: "reading",
    }),
  ).toEqual({ status: "idle" });
  // Stray events leave a settled loop alone.
  expect(
    transitionDownloadReadLoop(IDLE_DOWNLOAD_READ_LOOP, {
      type: "delay-elapsed",
    }),
  ).toBe(IDLE_DOWNLOAD_READ_LOOP);
  expect(
    transitionDownloadReadLoop(IDLE_DOWNLOAD_READ_LOOP, {
      type: "read-settled",
      watched: true,
    }),
  ).toBe(IDLE_DOWNLOAD_READ_LOOP);
});
