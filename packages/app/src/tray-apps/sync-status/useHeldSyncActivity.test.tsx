import { afterEach, expect, jest, test } from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useHeldSyncActivity } from "./useHeldSyncActivity";

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

const DELAYS = { enterMs: 40, exitMs: 60 };

// Fake timers, so the margins around each delay are exact rather than raced
// against a loaded runner.
function advance(ms: number) {
  act(() => {
    jest.advanceTimersByTime(ms);
  });
}

test("a short run never shows and a sustained one does until it settles", () => {
  jest.useFakeTimers();
  const { rerender, result } = renderHook(
    ({ active }: { active: boolean }) => useHeldSyncActivity(active, DELAYS),
    { initialProps: { active: false } },
  );
  rerender({ active: true });
  advance(39);
  rerender({ active: false });
  advance(100);
  expect(result.current).toBe(false);

  rerender({ active: true });
  advance(39);
  expect(result.current).toBe(false);
  advance(1);
  expect(result.current).toBe(true);
  // A gap shorter than the exit delay keeps it shown.
  rerender({ active: false });
  advance(59);
  expect(result.current).toBe(true);
  rerender({ active: true });
  advance(100);
  expect(result.current).toBe(true);
  rerender({ active: false });
  advance(59);
  expect(result.current).toBe(true);
  advance(1);
  expect(result.current).toBe(false);
});
