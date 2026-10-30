import { type PropsWithChildren, useCallback, useMemo, useState } from "react";
import { createRequiredContext } from "../createRequiredContext";
import {
  loadStoredPreference,
  saveStoredPreference,
} from "../launcher/storedPreference";
import { findWallpaper, type WallpaperDefinition } from "./wallpapers";

interface WallpaperContextValue {
  /** The wallpaper showing: the user's choice, or the host's default. */
  activeWallpaper: WallpaperDefinition;
  /** Records a wallpaper the host offers as the user's choice. */
  setWallpaper: (id: string) => void;
  /** Every wallpaper the host offers, in order. */
  wallpapers: readonly WallpaperDefinition[];
}

const wallpaperContext = createRequiredContext<WallpaperContextValue>(
  "useWallpaper must be used within a WallpaperProvider",
);

interface WallpaperProviderProps<Id extends string> extends PropsWithChildren {
  /** The wallpaper until the user picks one. Defaults to the first. */
  defaultWallpaper?: NoInfer<Id> | undefined;
  /** Where the user's choice persists in localStorage. */
  storageKey: string;
  /**
   * The wallpapers the host offers, in the order Display Properties lists
   * them. Define the list once, outside render.
   */
  wallpapers: readonly WallpaperDefinition<Id>[];
}

/**
 * Owns the desktop wallpaper: the host's `wallpapers` and the user's choice
 * among them, which {@link DesktopWallpaper} paints and Display Properties
 * changes. Mount one above every desktop that shares the choice.
 *
 * Only an explicit choice persists. A stored id the host no longer offers
 * counts as no choice, so the default shows.
 */
export function WallpaperProvider<Id extends string>({
  children,
  defaultWallpaper,
  storageKey,
  wallpapers,
}: WallpaperProviderProps<Id>) {
  const [choice, setChoice] = useState(() =>
    loadStoredPreference(storageKey, (stored) => stored),
  );
  const activeWallpaper =
    findWallpaper(wallpapers, choice) ??
    findWallpaper(wallpapers, defaultWallpaper) ??
    wallpapers[0];
  if (!activeWallpaper) {
    throw new Error("WallpaperProvider needs at least one wallpaper");
  }

  const setWallpaper = useCallback(
    (id: string) => {
      if (!findWallpaper(wallpapers, id)) {
        return;
      }
      setChoice(id);
      saveStoredPreference(storageKey, id);
    },
    [storageKey, wallpapers],
  );

  const value = useMemo<WallpaperContextValue>(
    () => ({ activeWallpaper, setWallpaper, wallpapers }),
    [activeWallpaper, setWallpaper, wallpapers],
  );

  return (
    <wallpaperContext.context.Provider value={value}>
      {children}
    </wallpaperContext.context.Provider>
  );
}

export const useWallpaper = wallpaperContext.useRequired;

// Non-throwing accessor: a desktop rendered without a provider shows no
// wallpaper, and Display Properties leaves out its Background section.
export const useOptionalWallpaper = wallpaperContext.useOptional;
