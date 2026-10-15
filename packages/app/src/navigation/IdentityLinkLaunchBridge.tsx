import {
  type NavigationMode,
  useLauncherNavigationActions,
} from "@tearleads/windowing";
import { useEffect, useRef } from "react";

/** Routed hosts already open this path; windowed hosts need to open its window. */
export function IdentityLinkLaunchBridge({
  enabled,
  mode,
}: {
  enabled: boolean;
  mode: NavigationMode;
}) {
  const { openMiniApp } = useLauncherNavigationActions();
  const handled = useRef<string | null>(null);
  useEffect(() => {
    const openLink = () => {
      const path = window.location.pathname;
      const prefix = "/app/contacts/import/";
      if (!path.startsWith(prefix) || handled.current === path) return;
      handled.current = path;
      if (!enabled || mode !== "windowed") return;
      openMiniApp({
        appId: "contacts",
        pathSegments: ["import", path.slice(prefix.length)],
      });
    };
    openLink();
    window.addEventListener("popstate", openLink);
    return () => window.removeEventListener("popstate", openLink);
  }, [enabled, mode, openMiniApp]);
  return null;
}
