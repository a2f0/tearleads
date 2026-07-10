import { afterEach, expect, test } from "bun:test";
import { cleanup, renderHook } from "@testing-library/react";
import type { ThemeId } from "./themes";
import { useThemeDocumentAttribute } from "./useThemeDocumentAttribute";

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-theme");
});

test("stamps the active theme onto the document root for theme CSS", () => {
  renderHook(() => useThemeDocumentAttribute("dark"));

  expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
});

test("clears the attribute on unmount so it does not leak globally", () => {
  const { unmount } = renderHook(() => useThemeDocumentAttribute("dark"));
  expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

  unmount();

  expect(document.documentElement.getAttribute("data-theme")).toBe(null);
});

test("updates the attribute when the theme changes", () => {
  const { rerender } = renderHook(
    ({ theme }: { theme: ThemeId }) => useThemeDocumentAttribute(theme),
    { initialProps: { theme: "light" as ThemeId } },
  );
  expect(document.documentElement.getAttribute("data-theme")).toBe("light");

  rerender({ theme: "dark" });

  expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
});
