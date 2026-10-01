import { expect, test } from "bun:test";
import type { WindowEntry } from "../types";
import { bringWindowToFront } from "./bringWindowToFront";
import { createWindowEntry } from "./createWindowEntry";
import { swapWindowZIndexes } from "./swapWindowZIndexes";

function makeWindows(): WindowEntry[] {
  return [
    createWindowEntry("1", "A", 0, 0, 1),
    createWindowEntry("2", "B", 10, 10, 2),
    createWindowEntry("3", "C", 20, 20, 3),
  ];
}

function byTitle(windows: WindowEntry[], title: string) {
  const windowEntry = windows.find((entry) => entry.title === title);
  if (!windowEntry) {
    throw new Error(`window "${title}" not found`);
  }
  return windowEntry;
}

function at(windows: WindowEntry[], index: number) {
  const windowEntry = windows[index];
  if (!windowEntry) {
    throw new Error(`no window at index ${index}`);
  }
  return windowEntry;
}

test("swapWindowZIndexes moves a window forward", () => {
  const windows = swapWindowZIndexes(makeWindows(), "1", "forward");

  expect(byTitle(windows, "A").zIndex).toBe(2);
  expect(byTitle(windows, "B").zIndex).toBe(1);
  expect(byTitle(windows, "C").zIndex).toBe(3);
});

test("swapWindowZIndexes moves a window backward", () => {
  const windows = swapWindowZIndexes(makeWindows(), "3", "backward");

  expect(byTitle(windows, "A").zIndex).toBe(1);
  expect(byTitle(windows, "B").zIndex).toBe(3);
  expect(byTitle(windows, "C").zIndex).toBe(2);
});

test("swapWindowZIndexes is a no-op for the topmost window", () => {
  const windows = swapWindowZIndexes(makeWindows(), "3", "forward");

  expect(byTitle(windows, "A").zIndex).toBe(1);
  expect(byTitle(windows, "B").zIndex).toBe(2);
  expect(byTitle(windows, "C").zIndex).toBe(3);
});

test("swapWindowZIndexes is a no-op for the bottommost window", () => {
  const windows = swapWindowZIndexes(makeWindows(), "1", "backward");

  expect(byTitle(windows, "A").zIndex).toBe(1);
  expect(byTitle(windows, "B").zIndex).toBe(2);
  expect(byTitle(windows, "C").zIndex).toBe(3);
});

test("bringWindowToFront moves a window above all others", () => {
  const windows = bringWindowToFront(makeWindows(), "1");

  expect(byTitle(windows, "A").zIndex).toBe(3);
  expect(byTitle(windows, "B").zIndex).toBe(1);
  expect(byTitle(windows, "C").zIndex).toBe(2);
});

test("bringWindowToFront is a no-op for the topmost window", () => {
  const windows = bringWindowToFront(makeWindows(), "3");

  expect(byTitle(windows, "A").zIndex).toBe(1);
  expect(byTitle(windows, "B").zIndex).toBe(2);
  expect(byTitle(windows, "C").zIndex).toBe(3);
});

test("swapWindowZIndexes preserves the array order", () => {
  const windows = swapWindowZIndexes(makeWindows(), "1", "forward");

  expect(at(windows, 0).title).toBe("A");
  expect(at(windows, 1).title).toBe("B");
  expect(at(windows, 2).title).toBe("C");
});
