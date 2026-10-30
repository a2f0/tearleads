import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { ThemeProvider } from "../theme/ThemeProvider";
import type { ThemeDefinition } from "../theme/themes";
import { DesktopWallpaper } from "../wallpaper/DesktopWallpaper";
import {
  BLOCKS_WALLPAPER,
  HONEYCOMB_WALLPAPER,
  PLAIN_WALLPAPER,
} from "../wallpaper/tessellations";
import { WallpaperProvider } from "../wallpaper/WallpaperProvider";
import { DisplayProperties } from "./DisplayProperties";

const THEME_KEY = "test.display.theme";
const WALLPAPER_KEY = "test.display.wallpaper";

const THEMES = [
  { id: "paper", label: "Paper", scheme: "light" },
  { id: "ink", label: "Ink", scheme: "dark" },
] as const satisfies readonly ThemeDefinition[];

const WALLPAPERS = [BLOCKS_WALLPAPER, HONEYCOMB_WALLPAPER, PLAIN_WALLPAPER];

afterEach(() => {
  cleanup();
  localStorage.removeItem(THEME_KEY);
  localStorage.removeItem(WALLPAPER_KEY);
  document.documentElement.removeAttribute("data-theme");
});

function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider defaultTheme="paper" storageKey={THEME_KEY} themes={THEMES}>
      <WallpaperProvider
        defaultWallpaper="blocks"
        storageKey={WALLPAPER_KEY}
        wallpapers={WALLPAPERS}
      >
        {children}
      </WallpaperProvider>
    </ThemeProvider>
  );
}

test("lists every wallpaper and theme with the active ones checked", () => {
  const view = render(<DisplayProperties />, { wrapper: Providers });
  const background = within(view.getByRole("group", { name: "Background" }));
  const wallpapers = background.getAllByRole("radio");
  expect(wallpapers.map((radio) => radio.getAttribute("value"))).toEqual([
    "blocks",
    "honeycomb",
    "plain",
  ]);
  expect(background.getByRole("radio", { name: "Blocks" })).toHaveProperty(
    "checked",
    true,
  );

  const theme = within(view.getByRole("group", { name: "Theme" }));
  expect(theme.getByRole("radio", { name: "Paper" })).toHaveProperty(
    "checked",
    true,
  );
  expect(theme.getByRole("radio", { name: "Ink" })).toHaveProperty(
    "checked",
    false,
  );
});

test("choosing a wallpaper repaints the desktop and persists the choice", () => {
  const view = render(
    <>
      <DesktopWallpaper />
      <DisplayProperties />
    </>,
    { wrapper: Providers },
  );
  fireEvent.click(view.getByRole("radio", { name: "Honeycomb" }));

  expect(view.getByRole("radio", { name: "Honeycomb" })).toHaveProperty(
    "checked",
    true,
  );
  expect(
    view.container
      .querySelector(".desktop-wallpaper")
      ?.getAttribute("data-wallpaper"),
  ).toBe("honeycomb");
  expect(localStorage.getItem(WALLPAPER_KEY)).toBe("honeycomb");
});

test("choosing a theme restamps the document and persists the choice", () => {
  const view = render(<DisplayProperties />, { wrapper: Providers });
  fireEvent.click(view.getByRole("radio", { name: "Ink" }));

  expect(document.documentElement.getAttribute("data-theme")).toBe("ink");
  expect(localStorage.getItem(THEME_KEY)).toBe("ink");
  expect(view.getByRole("radio", { name: "Ink" })).toHaveProperty(
    "checked",
    true,
  );
});

test("each swatch previews its own wallpaper", () => {
  const view = render(<DisplayProperties />, { wrapper: Providers });
  const swatches = view.container.querySelectorAll(
    ".display-properties-swatch",
  );
  expect(swatches).toHaveLength(3);
  expect(swatches[0]?.hasAttribute("data-pattern")).toBe(true);
  expect(swatches[2]?.hasAttribute("data-pattern")).toBe(false);
});

test("leaves out a section whose provider is missing", () => {
  const view = render(
    <ThemeProvider defaultTheme="paper" storageKey={THEME_KEY} themes={THEMES}>
      <DisplayProperties />
    </ThemeProvider>,
  );
  expect(view.queryByRole("group", { name: "Background" })).toBeNull();
  expect(view.getByRole("group", { name: "Theme" })).toBeDefined();
});
