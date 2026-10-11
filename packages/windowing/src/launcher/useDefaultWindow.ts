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
  const wasWindowed = useRef(false);

  useEffect(() => {
    const windowed = enabled && mode === "windowed";
    const enteredWindowed = windowed && !wasWindowed.current;
    // Record the entry before opening, including across StrictMode effects.
    wasWindowed.current = windowed;
    const { defaultWindowAppId } = definition;
    if (
      enteredWindowed &&
      windowCount === 0 &&
      isLauncherAppId(definition, defaultWindowAppId)
    ) {
      openMiniApp({ appId: defaultWindowAppId });
    }
  }, [definition, enabled, mode, openMiniApp, windowCount]);
}
