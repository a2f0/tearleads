import { afterEach, expect, test } from "bun:test";
import { cleanup, renderHook } from "@testing-library/react";
import type { ThemeId } from "./themes";
import { useThemeDocumentAttribute } from "./useThemeDocumentAttribute";

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-theme-scheme");
});

function rootAttributes() {
  return {
    theme: document.documentElement.getAttribute("data-theme"),
    scheme: document.documentElement.getAttribute("data-theme-scheme"),
  };
}

test("stamps the active theme and its scheme onto the document root", () => {
  renderHook(() => useThemeDocumentAttribute("dark"));

  expect(rootAttributes()).toEqual({ theme: "dark", scheme: "dark" });
});

test("clears both attributes on unmount so they do not leak globally", () => {
  const { unmount } = renderHook(() => useThemeDocumentAttribute("dark"));
  expect(rootAttributes()).toEqual({ theme: "dark", scheme: "dark" });

  unmount();

  expect(rootAttributes()).toEqual({ theme: null, scheme: null });
});

test("updates both attributes when the theme changes", () => {
  const { rerender } = renderHook(
    ({ theme }: { theme: ThemeId }) => useThemeDocumentAttribute(theme),
    { initialProps: { theme: "light" as ThemeId } },
  );
  expect(rootAttributes()).toEqual({ theme: "light", scheme: "light" });

  rerender({ theme: "dusk" });

  // Dusk is its own theme id but shares the dark scheme, so rules keyed on
  // the scheme (shadow depth, status glyphs, the native status bar) follow it.
  expect(rootAttributes()).toEqual({ theme: "dusk", scheme: "dark" });
});
