import {
  BLOCKS_WALLPAPER,
  HONEYCOMB_WALLPAPER,
  PLAIN_WALLPAPER,
  TRIANGLES_WALLPAPER,
  type WallpaperDefinition,
} from "@tearleads/windowing";

// The pane desktop's wallpapers, in the order Display Properties lists them.
// Each is a windowing tessellation painted in the theme's own colors, so every
// wallpaper suits Light, Dark, and Dusk alike.

export type WallpaperId = "blocks" | "honeycomb" | "triangles" | "plain";

export const APP_WALLPAPERS: readonly WallpaperDefinition<WallpaperId>[] = [
  BLOCKS_WALLPAPER,
  HONEYCOMB_WALLPAPER,
  TRIANGLES_WALLPAPER,
  PLAIN_WALLPAPER,
];

/** The wallpaper until the user picks one. */
export const DEFAULT_WALLPAPER: WallpaperId = "blocks";
