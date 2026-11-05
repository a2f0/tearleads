import { afterEach, expect, test } from "bun:test";
import { waitForBusyPaint } from "./waitForBusyPaint";

const originalRequestAnimationFrame = globalThis.requestAnimationFrame;

afterEach(() => {
  globalThis.requestAnimationFrame = originalRequestAnimationFrame;
});

test("waitForBusyPaint resolves after the next animation frame", async () => {
  const frames: FrameRequestCallback[] = [];
  globalThis.requestAnimationFrame = (callback) => {
    frames.push(callback);
    return frames.length;
  };
  let resolved = false;
  const pending = waitForBusyPaint().then(() => {
    resolved = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(resolved).toBe(false);

  frames.shift()?.(performance.now());
  await pending;
  expect(resolved).toBe(true);
});

// A hidden tab never runs animation frames; the action must still start.
test("waitForBusyPaint does not stall when animation frames are paused", async () => {
  globalThis.requestAnimationFrame = () => 1;
  const started = performance.now();
  await waitForBusyPaint();
  expect(performance.now() - started).toBeLessThan(1_000);
});
