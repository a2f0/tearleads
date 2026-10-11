import { useEffect, useRef } from "react";
import { isLauncherAppId, type LauncherDefinition } from "./launcherDefinition";
import type { NavigationMode } from "./navigationMode";

/** Opens the host's default once per entry into an empty windowed desktop. */
export function useDefaultWindow({
  definition,
  mode,
  openMiniApp,
  windowCount,
}: {
  definition: LauncherDefinition;
  mode: NavigationMode;
  openMiniApp: (request: { appId: string }) => string | null;
  windowCount: number;
}) {
  const previousMode = useRef<NavigationMode | null>(null);

  useEffect(() => {
    const enteredWindowed =
      mode === "windowed" && previousMode.current !== "windowed";
    // Record the entry before opening, including across StrictMode effects.
    previousMode.current = mode;
    const { defaultWindowAppId } = definition;
    if (
      enteredWindowed &&
      windowCount === 0 &&
      isLauncherAppId(definition, defaultWindowAppId)
    ) {
      openMiniApp({ appId: defaultWindowAppId });
    }
  }, [definition, mode, openMiniApp, windowCount]);
}
