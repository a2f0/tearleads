import { afterEach, expect, test } from "bun:test";
import { cleanup, renderHook } from "@testing-library/react";
import type { AppNavigationMode } from "./AppNavigationMode";
import { useNavigationModeDocumentAttribute } from "./useNavigationModeDocumentAttribute";

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-navigation-mode");
});

test("stamps the routed mode onto the document root for touch CSS", () => {
  renderHook(() => useNavigationModeDocumentAttribute("routed"));

  expect(document.documentElement.getAttribute("data-navigation-mode")).toBe(
    "routed",
  );
});

test("stamps the windowed mode onto the document root", () => {
  renderHook(() => useNavigationModeDocumentAttribute("windowed"));

  expect(document.documentElement.getAttribute("data-navigation-mode")).toBe(
    "windowed",
  );
});

test("updates the attribute when the mode crosses the breakpoint", () => {
  const { rerender } = renderHook(
    ({ mode }: { mode: AppNavigationMode }) =>
      useNavigationModeDocumentAttribute(mode),
    { initialProps: { mode: "windowed" } },
  );
  expect(document.documentElement.getAttribute("data-navigation-mode")).toBe(
    "windowed",
  );

  rerender({ mode: "routed" });

  expect(document.documentElement.getAttribute("data-navigation-mode")).toBe(
    "routed",
  );
});
