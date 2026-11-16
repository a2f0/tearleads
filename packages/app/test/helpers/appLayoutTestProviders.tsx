import { SystemTrayProvider } from "@tearleads/windowing";
import type { PropsWithChildren } from "react";
import { DeveloperModeProvider } from "../../src/providers/developer-mode/DeveloperModeProvider";
import { TRAY_APPS } from "../../src/tray-apps/registry";

/**
 * Mirrors production composition: Layout mounts the system tray's provider and
 * the developer-mode provider above every Pane, so a pane rendered on its own
 * shows the same tray apps and developer mode.
 */
export function AppLayoutTestProviders({ children }: PropsWithChildren) {
  return (
    <SystemTrayProvider definition={TRAY_APPS} storageKey="test.tray.disabled">
      <DeveloperModeProvider>{children}</DeveloperModeProvider>
    </SystemTrayProvider>
  );
}
