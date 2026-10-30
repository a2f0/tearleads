import { describe, expect, test } from "bun:test";
import {
  BLOCKS_WALLPAPER,
  CHEVRON_WALLPAPER,
  HARLEQUIN_WALLPAPER,
  HONEYCOMB_WALLPAPER,
  PLAIN_WALLPAPER,
  TRIANGLES_WALLPAPER,
} from "./tessellations";
import {
  findWallpaper,
  type WallpaperDefinition,
  wallpaperStyle,
  wallpaperTileUrl,
} from "./wallpapers";

const TESSELLATIONS: readonly WallpaperDefinition[] = [
  BLOCKS_WALLPAPER,
  HONEYCOMB_WALLPAPER,
  TRIANGLES_WALLPAPER,
  HARLEQUIN_WALLPAPER,
  CHEVRON_WALLPAPER,
];

function parseTile(svg: string): Document {
  return new DOMParser().parseFromString(svg, "image/svg+xml");
}

describe("built-in tessellations", () => {
  test("have distinct ids and labels", () => {
    const all = [...TESSELLATIONS, PLAIN_WALLPAPER];
    expect(new Set(all.map(({ id }) => id)).size).toBe(all.length);
    expect(new Set(all.map(({ label }) => label)).size).toBe(all.length);
  });

  for (const wallpaper of TESSELLATIONS) {
    test(`${wallpaper.label} draws one tile its declared size`, () => {
      const tile = wallpaper.tile;
      if (!tile) {
        throw new Error(`${wallpaper.id} has no tile`);
      }
      const root = parseTile(tile.svg).documentElement;
      expect(root.tagName.toLowerCase()).toBe("svg");
      expect(root.getAttribute("xmlns")).toBe("http://www.w3.org/2000/svg");
      expect(Number(root.getAttribute("width"))).toBe(tile.width);
      expect(Number(root.getAttribute("height"))).toBe(tile.height);
      expect(root.getAttribute("viewBox")).toBe(
        `0 0 ${tile.width} ${tile.height}`,
      );
      expect(tile.width).toBeGreaterThan(0);
      expect(tile.height).toBeGreaterThan(0);
      expect(root.querySelectorAll("polygon").length).toBeGreaterThan(0);
    });
  }

  test("the plain wallpaper has no pattern", () => {
    expect(PLAIN_WALLPAPER.tile).toBeUndefined();
  });
});

describe("wallpaperStyle", () => {
  test("paints a tile as a mask over the theme's tokens", () => {
    const tile = HONEYCOMB_WALLPAPER.tile;
    if (!tile) {
      throw new Error("honeycomb has no tile");
    }
    expect(wallpaperStyle(HONEYCOMB_WALLPAPER)).toEqual({
      "--wallpaper-base": "var(--desktop-wallpaper-base)",
      "--wallpaper-ink": "var(--desktop-wallpaper-ink)",
      "--wallpaper-mask": wallpaperTileUrl(tile),
      "--wallpaper-size": `${tile.width}px ${tile.height}px`,
    });
  });

  test("encodes the tile so the url survives quotes and hashes", () => {
    const url = wallpaperTileUrl({
      height: 1,
      svg: `<svg xmlns="http://www.w3.org/2000/svg"><path fill="#000"/></svg>`,
      width: 1,
    });
    expect(url.startsWith('url("data:image/svg+xml,')).toBe(true);
    const encoded = url.slice('url("data:image/svg+xml,'.length, -2);
    expect(encoded).not.toMatch(/["#<>]/);
    expect(decodeURIComponent(encoded)).toContain('fill="#000"');
  });

  test("a wallpaper's own colors win, and a plain one sets no mask", () => {
    expect(
      wallpaperStyle({
        base: "navy",
        id: "night",
        ink: "gold",
        label: "Night",
      }),
    ).toEqual({ "--wallpaper-base": "navy", "--wallpaper-ink": "gold" });
  });
});

test("findWallpaper matches by id only", () => {
  expect(findWallpaper(TESSELLATIONS, "blocks")).toBe(BLOCKS_WALLPAPER);
  expect(findWallpaper(TESSELLATIONS, "Blocks")).toBeUndefined();
  expect(findWallpaper(TESSELLATIONS, null)).toBeUndefined();
});
