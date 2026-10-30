import { WallpaperProvider as WindowingWallpaperProvider } from "@tearleads/windowing";
import type { PropsWithChildren } from "react";
import { APP_WALLPAPERS, DEFAULT_WALLPAPER } from "./wallpapers";

// Like the theme, the wallpaper is a display preference rather than
// per-identity data, so it persists once for the app, and every pane's desktop
// shows the one choice.
const WALLPAPER_CHOICE_STORAGE_KEY = "tearleads.wallpaper.choice";

/** Mounts beside the ThemeProvider in Layout, above every pane. */
export function WallpaperProvider({ children }: PropsWithChildren) {
  return (
    <WindowingWallpaperProvider
      defaultWallpaper={DEFAULT_WALLPAPER}
      storageKey={WALLPAPER_CHOICE_STORAGE_KEY}
      wallpapers={APP_WALLPAPERS}
    >
      {children}
    </WindowingWallpaperProvider>
  );
}
