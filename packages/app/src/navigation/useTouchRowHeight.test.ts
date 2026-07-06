import { afterEach, expect, test } from "bun:test";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { TOUCH_ROW_HEIGHT, useTouchRowHeight } from "./useTouchRowHeight";

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-navigation-mode");
});

test("returns the base height when the routed layout is not active", () => {
  const { result } = renderHook(() => useTouchRowHeight(28));

  expect(result.current).toBe(28);
});

test("raises a sub-44px row to the touch target in the routed layout", () => {
  document.documentElement.setAttribute("data-navigation-mode", "routed");

  const { result } = renderHook(() => useTouchRowHeight(28));

  expect(result.current).toBe(TOUCH_ROW_HEIGHT);
});

test("leaves a row already at/above the touch target unchanged", () => {
  document.documentElement.setAttribute("data-navigation-mode", "routed");

  const { result } = renderHook(() => useTouchRowHeight(48));

  expect(result.current).toBe(48);
});

test("reacts when the layout crosses into the routed shell", async () => {
  const { result } = renderHook(() => useTouchRowHeight(28));
  expect(result.current).toBe(28);

  act(() => {
    document.documentElement.setAttribute("data-navigation-mode", "routed");
  });

  await waitFor(() => {
    expect(result.current).toBe(TOUCH_ROW_HEIGHT);
  });
});

test("fans a single shared observer out to concurrent subscribers", async () => {
  const first = renderHook(() => useTouchRowHeight(28));
  const second = renderHook(() => useTouchRowHeight(36));
  expect(first.result.current).toBe(28);
  expect(second.result.current).toBe(36);

  act(() => {
    document.documentElement.setAttribute("data-navigation-mode", "routed");
  });

  await waitFor(() => {
    expect(first.result.current).toBe(TOUCH_ROW_HEIGHT);
    expect(second.result.current).toBe(TOUCH_ROW_HEIGHT);
  });
});
