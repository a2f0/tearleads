import { afterEach, beforeEach, expect, test } from "bun:test";
import { BUSY_PAINT_FALLBACK_MS, waitForBusyPaint } from "./waitForBusyPaint";

// Timers and frames are driven by hand, so no assertion depends on machine
// speed: under load a real 10 ms sleep can overrun the 100 ms fallback, and a
// real fallback timer can take over a second to fire.
interface ScheduledTimer {
  readonly callback: () => void;
  readonly delay: number;
  cleared: boolean;
}

const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;

let timers: ScheduledTimer[] = [];
let frames: FrameRequestCallback[] = [];

beforeEach(() => {
  timers = [];
  frames = [];
  const fakeSetTimeout = (callback: () => void, delay = 0) => {
    timers.push({ callback, delay, cleared: false });
    return timers.length;
  };
  const fakeClearTimeout = (id?: number) => {
    const timer = typeof id === "number" ? timers[id - 1] : undefined;
    if (timer) timer.cleared = true;
  };
  globalThis.setTimeout = fakeSetTimeout as unknown as typeof setTimeout;
  globalThis.clearTimeout = fakeClearTimeout as typeof clearTimeout;
  globalThis.requestAnimationFrame = (callback) => {
    frames.push(callback);
    return frames.length;
  };
});

afterEach(() => {
  globalThis.requestAnimationFrame = originalRequestAnimationFrame;
  globalThis.setTimeout = originalSetTimeout;
  globalThis.clearTimeout = originalClearTimeout;
});

function startWait(): () => boolean {
  let resolved = false;
  void waitForBusyPaint().then(() => {
    resolved = true;
  });
  return () => resolved;
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

test("waitForBusyPaint resolves after the next animation frame", async () => {
  const isResolved = startWait();
  expect(timers.map((timer) => timer.delay)).toEqual([BUSY_PAINT_FALLBACK_MS]);
  expect(frames).toHaveLength(1);
  await flushMicrotasks();
  expect(isResolved()).toBe(false);

  frames[0]?.(0);
  const [fallback, afterFrame] = timers;
  expect(fallback?.cleared).toBe(true);
  expect(afterFrame?.delay).toBe(0);
  await flushMicrotasks();
  expect(isResolved()).toBe(false);

  afterFrame?.callback();
  await flushMicrotasks();
  expect(isResolved()).toBe(true);
});

// A hidden tab never runs animation frames; the action must still start.
test("waitForBusyPaint does not stall when animation frames are paused", async () => {
  const isResolved = startWait();
  expect(timers.map((timer) => timer.delay)).toEqual([BUSY_PAINT_FALLBACK_MS]);
  await flushMicrotasks();
  expect(isResolved()).toBe(false);

  timers[0]?.callback();
  await flushMicrotasks();
  expect(isResolved()).toBe(true);
});
