import type { CSSProperties } from "react";

/**
 * One tile of a repeating wallpaper pattern. The tile's SVG is a mask, not a
 * picture: where its shapes are opaque the wallpaper paints its ink, where
 * they are translucent (`fill-opacity`, `stroke-opacity`) it paints that share
 * of the ink, and elsewhere the base shows. The markup's own colors are
 * ignored, so one tile follows every theme.
 */
export interface WallpaperTile {
  /** The tile's height in CSS pixels; the pattern repeats at this size. */
  readonly height: number;
  /**
   * The tile as a standalone SVG document (with its `xmlns`), drawn edge to
   * edge across `width` by `height` so neighboring tiles meet seamlessly.
   */
  readonly svg: string;
  /** The tile's width in CSS pixels. */
  readonly width: number;
}

/**
 * A desktop wallpaper a host offers: a base color and, optionally, a pattern
 * repeated over it in an ink color. Unless it names its own, the colors come
 * from the theme: the `--desktop-wallpaper-base` and `--desktop-wallpaper-ink`
 * tokens where a host sets them, else the desk color (`--desktop-background`,
 * then `--color-light`) under a faint wash of `--color-dark`.
 */
export interface WallpaperDefinition<Id extends string = string> {
  /** A CSS color under the pattern. */
  readonly base?: string | undefined;
  readonly id: Id;
  /** A CSS color the pattern paints in. */
  readonly ink?: string | undefined;
  /** The wallpaper's name, as Display Properties lists it. */
  readonly label: string;
  /** The repeating pattern. Without one the wallpaper is its base alone. */
  readonly tile?: WallpaperTile | undefined;
}

// The theme's colors, resolved on the wallpaper's own element, so a theme
// scoped below the document root reaches the desktop and the previews alike.
const THEME_BASE =
  "var(--desktop-wallpaper-base, var(--desktop-background, var(--color-light)))";
const THEME_INK =
  "var(--desktop-wallpaper-ink, color-mix(in srgb, var(--color-dark) 12%, transparent))";

type WallpaperStyle = CSSProperties & {
  "--wallpaper-base": string;
  "--wallpaper-ink": string;
  "--wallpaper-mask"?: string;
  "--wallpaper-size"?: string;
};

/** The tile's SVG as a `url()` value. */
export function wallpaperTileUrl(tile: WallpaperTile): string {
  return `url("data:image/svg+xml,${encodeURIComponent(tile.svg)}")`;
}

/**
 * The custom properties a `.wallpaper-pattern` element paints a wallpaper
 * from: its colors, and its tile as a mask repeated at the tile's size.
 */
export function wallpaperStyle(wallpaper: WallpaperDefinition): WallpaperStyle {
  const style: WallpaperStyle = {
    "--wallpaper-base": wallpaper.base ?? THEME_BASE,
    "--wallpaper-ink": wallpaper.ink ?? THEME_INK,
  };
  if (wallpaper.tile) {
    style["--wallpaper-mask"] = wallpaperTileUrl(wallpaper.tile);
    style["--wallpaper-size"] =
      `${wallpaper.tile.width}px ${wallpaper.tile.height}px`;
  }
  return style;
}

export function findWallpaper<Id extends string>(
  wallpapers: readonly WallpaperDefinition<Id>[],
  id: string | null | undefined,
): WallpaperDefinition<Id> | undefined {
  return wallpapers.find((wallpaper) => wallpaper.id === id);
}
