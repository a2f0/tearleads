import { useEffect, useRef } from "react";
import { isLauncherAppId, type LauncherDefinition } from "./launcherDefinition";
import type { NavigationMode } from "./navigationMode";

/** Opens the host's default once per entry into an empty windowed desktop. */
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
    const { defaultWindowAppId } = definition;
    if (windowCount === 0 && isLauncherAppId(definition, defaultWindowAppId)) {
      openMiniApp({ appId: defaultWindowAppId });
    }
  }, [definition, enabled, mode, openMiniApp, windowCount]);
}
