import { useCallback, useEffect, useReducer, useRef } from "react";
import type { RoutedLayoutTier } from "../launcher/useRoutedLayoutTier";
import type { LauncherPlacement } from "./launcherPlacement";
import {
  initialRoutedPaneOverlaysState,
  isRoutedDrawerOpen,
  isRoutedSidebarExpanded,
  transitionRoutedPaneOverlays,
} from "./routedPaneOverlaysMachine";

export function invertBoolean(value: boolean): boolean {
  return !value;
}

function useEscapeToDismissOverlay(open: boolean, onDismiss: () => void) {
  useEffect(() => {
    if (!open) {
      return;
    }
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        onDismiss();
      }
    };
    document.addEventListener("keydown", dismissOnEscape);
    return () => document.removeEventListener("keydown", dismissOnEscape);
  }, [onDismiss, open]);
}

/**
 * The sidebar and the launcher sheet: whether each is open, and the actions
 * that open, close, and move them. Dismissing a mobile overlay returns focus
 * to the button that opened it (the taskbar menu button or app-bar sidebar
 * toggle).
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
  const [overlayState, dispatch] = useReducer(
    transitionRoutedPaneOverlays,
    initialSidebarExpanded,
    (init) => initialRoutedPaneOverlaysState(init()),
  );
  const sidebarExpanded = isRoutedSidebarExpanded(overlayState);
  const drawerOpen = isRoutedDrawerOpen(overlayState);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const sidebarButtonRef = useRef<HTMLButtonElement>(null);

  const toggleSidebar = useCallback(
    () => dispatch({ tier, type: "toggle-sidebar" }),
    [tier],
  );
  const closeSidebar = useCallback(
    () => dispatch({ type: "close-sidebar" }),
    [],
  );
  const dismissSidebar = useCallback(() => {
    dispatch({ type: "close-sidebar" });
    sidebarButtonRef.current?.focus();
  }, []);
  const toggleDrawer = useCallback(
    () => dispatch({ tier, type: "toggle-drawer" }),
    [tier],
  );
  const closeDrawer = useCallback(() => dispatch({ type: "close-drawer" }), []);
  const dismissDrawer = useCallback(() => {
    dispatch({ type: "close-drawer" });
    menuButtonRef.current?.focus();
  }, []);

  useEscapeToDismissOverlay(drawerOpen, dismissDrawer);
  useEscapeToDismissOverlay(
    tier === "mobile" && sidebarExpanded,
    dismissSidebar,
  );

  const moveLauncher = () => {
    const wasOpen =
      launcherPlacement === "side" ? navigationRailExpanded : drawerOpen;
    dispatch({
      open: launcherPlacement === "side" && wasOpen,
      tier,
      type: "set-drawer-open",
    });
    menuButtonRef.current?.focus();
    onToggleLauncherPlacement(wasOpen);
  };

  // Reset tier-specific overlays when crossing the mobile/tablet breakpoint
  // (resize / rotation).
  const initialTierRef = useRef(tier);
  useEffect(() => {
    if (initialTierRef.current === tier) {
      return;
    }
    initialTierRef.current = tier;
    dispatch({ tier, type: "tier-changed" });
  }, [tier]);

  return {
    closeDrawer,
    closeSidebar,
    dismissDrawer,
    dismissSidebar,
    drawerOpen,
    menuButtonRef,
    moveLauncher,
    sidebarButtonRef,
    sidebarExpanded,
    toggleDrawer,
    toggleSidebar,
  };
}
