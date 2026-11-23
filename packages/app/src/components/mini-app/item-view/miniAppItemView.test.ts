import { afterEach, expect, test } from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import {
  getMiniAppItemViewRowHeight,
  getNextMiniAppItemView,
  loadMiniAppItemView,
  MINI_APP_LARGE_ROW_HEIGHT,
  type MiniAppItemView,
  useMiniAppItemView,
} from "./miniAppItemView";

const STORAGE_KEY = "test.mini-app-item-view";

afterEach(() => {
  cleanup();
  localStorage.removeItem(STORAGE_KEY);
});

test("the view cycles through every offered view in order and wraps", () => {
  expect(getNextMiniAppItemView("rows")).toBe("large-rows");
  expect(getNextMiniAppItemView("large-rows")).toBe("grid");
  expect(getNextMiniAppItemView("grid")).toBe("rows");

  const rowSizes: ReadonlyArray<MiniAppItemView> = ["rows", "large-rows"];
  expect(getNextMiniAppItemView("large-rows", rowSizes)).toBe("rows");
});

test("a large row has one pitch whether or not the table folds", () => {
  expect(getMiniAppItemViewRowHeight("large-rows", false)).toBe(
    MINI_APP_LARGE_ROW_HEIGHT,
  );
  expect(getMiniAppItemViewRowHeight("large-rows", true)).toBe(
    MINI_APP_LARGE_ROW_HEIGHT,
  );
  expect(getMiniAppItemViewRowHeight("rows", false)).toBe(36);
  expect(getMiniAppItemViewRowHeight("rows", true)).toBe(56);
});

test("a stored view a surface does not offer falls back to the dense rows", () => {
  localStorage.setItem(STORAGE_KEY, "grid");
  expect(loadMiniAppItemView(STORAGE_KEY)).toBe("grid");
  expect(loadMiniAppItemView(STORAGE_KEY, ["rows", "large-rows"])).toBe("rows");

  localStorage.setItem(STORAGE_KEY, "columns");
  expect(loadMiniAppItemView(STORAGE_KEY)).toBe("rows");
});

test("cycling the view persists each choice for the next mount", () => {
  const first = renderHook(() => useMiniAppItemView(STORAGE_KEY));
  expect(first.result.current.view).toBe("rows");
  expect(first.result.current.nextView).toBe("large-rows");

  act(() => first.result.current.cycleView());
  expect(first.result.current.view).toBe("large-rows");
  act(() => first.result.current.cycleView());
  expect(first.result.current.view).toBe("grid");
  expect(first.result.current.nextView).toBe("rows");
  first.unmount();

  const second = renderHook(() => useMiniAppItemView(STORAGE_KEY));
  expect(second.result.current.view).toBe("grid");
});
