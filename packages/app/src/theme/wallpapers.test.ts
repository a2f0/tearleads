import { expect, test } from "bun:test";
import {
  BLOCKS_WALLPAPER,
  HONEYCOMB_WALLPAPER,
  PLAIN_WALLPAPER,
  TRIANGLES_WALLPAPER,
} from "@tearleads/windowing";
import { APP_WALLPAPERS, DEFAULT_WALLPAPER } from "./wallpapers";

test("offers the designed host collection first with Tidal as the unsaved default", () => {
  expect(DEFAULT_WALLPAPER).toBe("tidal");
  expect(APP_WALLPAPERS.map(({ id, label }) => ({ id, label }))).toEqual([
    { id: "tidal", label: "Tidal" },
    { id: "facet", label: "Facet" },
    { id: "loom", label: "Loom" },
    { id: "blocks", label: "Blocks" },
    { id: "honeycomb", label: "Honeycomb" },
    { id: "triangles", label: "Triangles" },
    { id: "plain", label: "None" },
  ]);
  expect(APP_WALLPAPERS.slice(3)).toEqual([
    BLOCKS_WALLPAPER,
    HONEYCOMB_WALLPAPER,
    TRIANGLES_WALLPAPER,
    PLAIN_WALLPAPER,
  ]);
  for (const wallpaper of APP_WALLPAPERS.slice(0, 3)) {
    expect(wallpaper.tile?.width).toBeGreaterThanOrEqual(128);
    expect(wallpaper.tile?.height).toBeGreaterThanOrEqual(128);
    expect(wallpaper.tile?.svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(wallpaper.base).toContain("var(--tearleads-background");
    expect(wallpaper.ink).toContain("var(--color-dark)");
  }
});
