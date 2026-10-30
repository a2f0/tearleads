import { afterEach, expect, test } from "bun:test";
import { act, cleanup, render, renderHook } from "@testing-library/react";
import { DesktopWallpaper } from "./DesktopWallpaper";
import {
  BLOCKS_WALLPAPER,
  HONEYCOMB_WALLPAPER,
  PLAIN_WALLPAPER,
} from "./tessellations";
import { useWallpaper, WallpaperProvider } from "./WallpaperProvider";

const STORAGE_KEY = "test.wallpaper";
const WALLPAPERS = [BLOCKS_WALLPAPER, HONEYCOMB_WALLPAPER, PLAIN_WALLPAPER];

afterEach(() => {
  cleanup();
  localStorage.removeItem(STORAGE_KEY);
});

function wallpaperLayer(container: HTMLElement): HTMLElement | null {
  return container.querySelector(".desktop-wallpaper");
}

function renderDesktop(defaultWallpaper?: "blocks" | "honeycomb" | "plain") {
  return render(
    <WallpaperProvider
      defaultWallpaper={defaultWallpaper}
      storageKey={STORAGE_KEY}
      wallpapers={WALLPAPERS}
    >
      <DesktopWallpaper />
    </WallpaperProvider>,
  );
}

test("paints the default wallpaper, hidden from assistive technology", () => {
  const { container } = renderDesktop("honeycomb");
  const layer = wallpaperLayer(container);
  expect(layer?.getAttribute("data-wallpaper")).toBe("honeycomb");
  expect(layer?.getAttribute("aria-hidden")).toBe("true");
  expect(layer?.hasAttribute("data-pattern")).toBe(true);
  expect(layer?.style.getPropertyValue("--wallpaper-mask")).toContain(
    "data:image/svg+xml,",
  );
});

test("defaults to the first wallpaper when the host names none", () => {
  const { container } = renderDesktop();
  expect(wallpaperLayer(container)?.getAttribute("data-wallpaper")).toBe(
    "blocks",
  );
});

test("a plain wallpaper paints no pattern layer", () => {
  const { container } = renderDesktop("plain");
  expect(wallpaperLayer(container)?.hasAttribute("data-pattern")).toBe(false);
});

test("shows the stored choice, and ignores one the host no longer offers", () => {
  localStorage.setItem(STORAGE_KEY, "honeycomb");
  const first = renderDesktop("blocks");
  expect(wallpaperLayer(first.container)?.getAttribute("data-wallpaper")).toBe(
    "honeycomb",
  );
  cleanup();

  localStorage.setItem(STORAGE_KEY, "retired");
  const second = renderDesktop("plain");
  expect(wallpaperLayer(second.container)?.getAttribute("data-wallpaper")).toBe(
    "plain",
  );
});

test("setWallpaper persists offered wallpapers and ignores others", () => {
  const { result } = renderHook(() => useWallpaper(), {
    wrapper: ({ children }) => (
      <WallpaperProvider storageKey={STORAGE_KEY} wallpapers={WALLPAPERS}>
        {children}
      </WallpaperProvider>
    ),
  });
  expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

  act(() => result.current.setWallpaper("honeycomb"));
  expect(result.current.activeWallpaper).toBe(HONEYCOMB_WALLPAPER);
  expect(localStorage.getItem(STORAGE_KEY)).toBe("honeycomb");

  act(() => result.current.setWallpaper("retired"));
  expect(result.current.activeWallpaper).toBe(HONEYCOMB_WALLPAPER);
  expect(localStorage.getItem(STORAGE_KEY)).toBe("honeycomb");
});

test("a wallpaper prop wins over the provider, and nothing renders without either", () => {
  const withProp = render(
    <WallpaperProvider storageKey={STORAGE_KEY} wallpapers={WALLPAPERS}>
      <DesktopWallpaper wallpaper={PLAIN_WALLPAPER} />
    </WallpaperProvider>,
  );
  expect(
    wallpaperLayer(withProp.container)?.getAttribute("data-wallpaper"),
  ).toBe("plain");
  cleanup();

  const bare = render(<DesktopWallpaper />);
  expect(wallpaperLayer(bare.container)).toBeNull();
});

test("a provider with no wallpapers throws", () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    expect(() =>
      render(
        <WallpaperProvider storageKey={STORAGE_KEY} wallpapers={[]}>
          <DesktopWallpaper />
        </WallpaperProvider>,
      ),
    ).toThrow("WallpaperProvider needs at least one wallpaper");
  } finally {
    console.error = originalError;
  }
});
