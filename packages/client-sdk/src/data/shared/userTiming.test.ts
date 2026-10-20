import { expect, spyOn, test } from "bun:test";
import { readUserTimingClock, recordUserTimingEntry } from "./userTiming";

function withoutPerformance(run: () => void): void {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "performance");
  Object.defineProperty(globalThis, "performance", {
    configurable: true,
    value: undefined,
  });
  try {
    run();
  } finally {
    if (descriptor) {
      Object.defineProperty(globalThis, "performance", descriptor);
    }
  }
}

test("an entry is measured on its DevTools track and cleared at once", () => {
  const measure = spyOn(performance, "measure");
  const clearMeasures = spyOn(performance, "clearMeasures");
  try {
    recordUserTimingEntry({
      endMs: 30,
      failed: true,
      name: "Sync lane: Container contents",
      properties: [["phase", "structural"]],
      startMs: 10,
      track: "Sync lanes",
    });

    expect(measure).toHaveBeenCalledWith("Sync lane: Container contents", {
      detail: {
        devtools: {
          color: "error",
          dataType: "track-entry",
          properties: [["phase", "structural"]],
          track: "Sync lanes",
          trackGroup: "Tearleads",
        },
      },
      end: 30,
      start: 10,
    });
    expect(clearMeasures).toHaveBeenCalledWith("Sync lane: Container contents");
    expect(
      performance.getEntriesByName("Sync lane: Container contents"),
    ).toEqual([]);
  } finally {
    measure.mockRestore();
    clearMeasures.mockRestore();
  }
});

test("a throwing measure never reaches the caller", () => {
  const measure = spyOn(performance, "measure").mockImplementation(() => {
    throw new TypeError("start is after end");
  });
  try {
    expect(() =>
      recordUserTimingEntry({
        endMs: 1,
        name: "SQLite mutation",
        startMs: 2,
        track: "SQLite mutations",
      }),
    ).not.toThrow();
  } finally {
    measure.mockRestore();
  }
});

test("a runtime without performance records nothing and reads wall time", () => {
  withoutPerformance(() => {
    expect(() =>
      recordUserTimingEntry({
        endMs: 2,
        name: "SQLite mutation",
        startMs: 1,
        track: "SQLite mutations",
      }),
    ).not.toThrow();
    const before = Date.now();
    const clock = readUserTimingClock();
    expect(clock).toBeGreaterThanOrEqual(before);
    expect(clock).toBeLessThanOrEqual(Date.now());
  });
});
