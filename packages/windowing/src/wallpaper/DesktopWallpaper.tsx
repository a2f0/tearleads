import { useOptionalWallpaper } from "./WallpaperProvider";
import { type WallpaperDefinition, wallpaperStyle } from "./wallpapers";
import "./Wallpaper.css";

export interface DesktopWallpaperProps {
  /** Paints this wallpaper instead of the nearest provider's choice. */
  wallpaper?: WallpaperDefinition | undefined;
}

/**
 * The wallpaper behind the desktop's icons and windows: the nearest
 * {@link WallpaperProvider}'s choice, or `wallpaper`. Render it as the first
 * child of the positioned surface the windows lay out on, before
 * `DesktopIcons`. It takes no pointer input, so presses reach the surface.
 * Without a provider or a `wallpaper` it renders nothing.
 */
export function DesktopWallpaper({ wallpaper }: DesktopWallpaperProps) {
  const context = useOptionalWallpaper();
  const shown = wallpaper ?? context?.activeWallpaper;
  if (!shown) {
    return null;
  }
  return (
    <div
      aria-hidden="true"
      className="desktop-wallpaper wallpaper-pattern"
      data-pattern={shown.tile ? "" : undefined}
      data-wallpaper={shown.id}
      style={wallpaperStyle(shown)}
    />
  );
}
