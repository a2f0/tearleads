import { useCallback, useEffect, useRef, useState } from "react";
import type { RoutedLayoutTier } from "../launcher/useRoutedLayoutTier";
import type { LauncherPlacement } from "./launcherPlacement";

export function invertBoolean(value: boolean): boolean {
  return !value;
}

// Reset the tier-specific overlays when the layout crosses the breakpoint
// (resize / rotation): the bottom sheet belongs to mobile or tablet bottom
// mode, and the expanded sidebar becomes a full-screen dialog on mobile.
function useCollapseOverlaysOnTierChange({
  closeDrawer,
  closeSidebar,
  tier,
}: {
  closeDrawer: () => void;
  closeSidebar: () => void;
  tier: RoutedLayoutTier;
}) {
  useEffect(() => {
    if (tier === "tablet") {
      closeDrawer();
    }
  }, [tier, closeDrawer]);

  useEffect(() => {
    if (tier === "mobile") {
      closeSidebar();
    }
  }, [tier, closeSidebar]);
}

function useEscapeToDismissDrawer(
  drawerOpen: boolean,
  dismissDrawer: () => void,
) {
  useEffect(() => {
    if (!drawerOpen) {
      return;
    }
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        dismissDrawer();
      }
    };
    document.addEventListener("keydown", dismissOnEscape);
    return () => document.removeEventListener("keydown", dismissOnEscape);
  }, [dismissDrawer, drawerOpen]);
}

/**
 * The sidebar and the launcher sheet: whether each is open, and the actions
 * that open, close, and move them. Dismissing the sheet returns focus to the
 * taskbar's menu button, which opened it.
 */
export function useRoutedPaneOverlays({
  initialSidebarExpanded,
  launcherPlacement,
  navigationRailExpanded,
  onToggleLauncherPlacement,
  tier,
}: {
  initialSidebarExpanded: () => boolean;
  launcherPlacement: LauncherPlacement;
  navigationRailExpanded: boolean;
  onToggleLauncherPlacement: (wasOpen: boolean) => void;
  tier: RoutedLayoutTier;
}) {
  const [sidebarExpanded, setSidebarExpanded] = useState(
    initialSidebarExpanded,
  );
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  const toggleSidebar = useCallback(
    () => setSidebarExpanded(invertBoolean),
    [],
  );
  const closeSidebar = useCallback(() => setSidebarExpanded(false), []);
  const toggleDrawer = useCallback(() => setDrawerOpen(invertBoolean), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const dismissDrawer = useCallback(() => {
    closeDrawer();
    menuButtonRef.current?.focus();
  }, [closeDrawer]);
  useEscapeToDismissDrawer(drawerOpen, dismissDrawer);
  const moveLauncher = () => {
    const wasOpen =
      launcherPlacement === "side" ? navigationRailExpanded : drawerOpen;
    setDrawerOpen(launcherPlacement === "side" && wasOpen);
    menuButtonRef.current?.focus();
    onToggleLauncherPlacement(wasOpen);
  };

  useCollapseOverlaysOnTierChange({ closeDrawer, closeSidebar, tier });

  return {
    closeDrawer,
    closeSidebar,
    dismissDrawer,
    drawerOpen,
    menuButtonRef,
    moveLauncher,
    sidebarExpanded,
    toggleDrawer,
    toggleSidebar,
  };
}
