import { useEffect, useRef } from "react";
import {
  type LauncherDefinition,
  resolveLauncherAppIds,
} from "./launcherDefinition";
import type { NavigationMode } from "./navigationMode";

/**
 * Opens the host's default windows, in order so the last is in front, once
 * per entry into an empty windowed desktop.
 */
export function useDefaultWindow({
  definition,
  enabled,
  mode,
  openMiniApp,
  windowCount,
}: {
  definition: LauncherDefinition;
  enabled: boolean;
  mode: NavigationMode;
  openMiniApp: (request: { appId: string }) => string | null;
  windowCount: number;
}) {
  const handledWindowedEntry = useRef(false);

  useEffect(() => {
    if (mode !== "windowed") {
      handledWindowedEntry.current = false;
      return;
    }
    if (!enabled || handledWindowedEntry.current) return;
    // Record the entry before opening, including across StrictMode effects.
    handledWindowedEntry.current = true;
    if (windowCount > 0) return;
    for (const appId of resolveLauncherAppIds(
      definition,
      definition.defaultWindowAppIds,
    )) {
      openMiniApp({ appId });
    }
  }, [definition, enabled, mode, openMiniApp, windowCount]);
}
