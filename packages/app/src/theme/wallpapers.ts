import {
  BLOCKS_WALLPAPER,
  HONEYCOMB_WALLPAPER,
  PLAIN_WALLPAPER,
  TRIANGLES_WALLPAPER,
  type WallpaperDefinition,
} from "@tearleads/windowing";

import {
  FACET_WALLPAPER,
  LOOM_WALLPAPER,
  TIDAL_WALLPAPER,
} from "./designedWallpapers";

// Host-designed artwork leads; existing saved choices keep their ids and art.
export type WallpaperId =
  | "tidal"
  | "facet"
  | "loom"
  | "blocks"
  | "honeycomb"
  | "triangles"
  | "plain";

export const APP_WALLPAPERS: readonly WallpaperDefinition<WallpaperId>[] = [
  TIDAL_WALLPAPER,
  FACET_WALLPAPER,
  LOOM_WALLPAPER,
  BLOCKS_WALLPAPER,
  HONEYCOMB_WALLPAPER,
  TRIANGLES_WALLPAPER,
  PLAIN_WALLPAPER,
];

/** The wallpaper until the user picks one. */
export const DEFAULT_WALLPAPER: WallpaperId = "tidal";
