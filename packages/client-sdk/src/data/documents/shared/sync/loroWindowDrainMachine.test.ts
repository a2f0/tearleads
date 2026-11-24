import { expect, test } from "bun:test";
import {
  LORO_WINDOW_DRAIN_OPEN,
  type LoroWindowDrain,
  transitionLoroWindowDrain,
} from "./loroWindowDrainMachine";

const DRAINING: LoroWindowDrain = { drain: 1, status: "draining" };
const HOLDING: LoroWindowDrain = { drain: 1, drained: true, status: "holding" };

// A drain with windows open waits for them; with none it holds at once, and
// a second request while draining joins the first.
test("a drain waits for open windows and holds once they close", () => {
  expect(
    transitionLoroWindowDrain(LORO_WINDOW_DRAIN_OPEN, {
      drain: 1,
      openWindows: 2,
      type: "drainRequested",
    }),
  ).toEqual(DRAINING);
  expect(
    transitionLoroWindowDrain(LORO_WINDOW_DRAIN_OPEN, {
      drain: 1,
      openWindows: 0,
      type: "drainRequested",
    }),
  ).toEqual(HOLDING);
  expect(
    transitionLoroWindowDrain(DRAINING, {
      drain: 2,
      openWindows: 1,
      type: "drainRequested",
    }),
  ).toBe(DRAINING);
  expect(
    transitionLoroWindowDrain(DRAINING, { type: "windowsClosed" }),
  ).toEqual(HOLDING);
  expect(
    transitionLoroWindowDrain(DRAINING, { drain: 1, type: "waitEnded" }),
  ).toEqual({ drain: 1, drained: false, status: "holding" });
});

// Only the current drain's timers move it: a stale wait or hold changes
// nothing, and a hold ends only by its own timer.
test("a stale wait or hold changes nothing", () => {
  expect(
    transitionLoroWindowDrain(DRAINING, { drain: 0, type: "waitEnded" }),
  ).toBe(DRAINING);
  expect(
    transitionLoroWindowDrain(HOLDING, { drain: 0, type: "holdEnded" }),
  ).toBe(HOLDING);
  expect(transitionLoroWindowDrain(HOLDING, { type: "windowsClosed" })).toBe(
    HOLDING,
  );
  expect(
    transitionLoroWindowDrain(HOLDING, { drain: 1, type: "holdEnded" }),
  ).toBe(LORO_WINDOW_DRAIN_OPEN);
});

// A request while holding holds afresh, under its own tag, or drains again
// a window that entered outside the gate during the hold.
test("a request while holding holds afresh or drains again", () => {
  expect(
    transitionLoroWindowDrain(HOLDING, {
      drain: 2,
      openWindows: 0,
      type: "drainRequested",
    }),
  ).toEqual({ drain: 2, drained: true, status: "holding" });
  expect(
    transitionLoroWindowDrain(HOLDING, {
      drain: 2,
      openWindows: 1,
      type: "drainRequested",
    }),
  ).toEqual({ drain: 2, status: "draining" });
});
