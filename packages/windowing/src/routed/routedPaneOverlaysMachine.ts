import type { RoutedLayoutTier } from "../launcher/useRoutedLayoutTier";

/**
 * Closed overlay state for the routed shell.
 *
 * On mobile, the sidebar and launcher sheet are both modal overlays and are
 * mutually exclusive (`sidebar-and-drawer` is unreachable on mobile). On tablet,
 * the sidebar docks inline beside the content pane while the bottom launcher
 * sheet can open independently.
 */
export type RoutedPaneOverlaysState =
  | { readonly status: "closed" }
  | { readonly status: "sidebar" }
  | { readonly status: "drawer" }
  | { readonly status: "sidebar-and-drawer" };

export type RoutedPaneOverlaysEvent =
  | { readonly type: "toggle-sidebar"; readonly tier: RoutedLayoutTier }
  | { readonly type: "close-sidebar" }
  | { readonly type: "toggle-drawer"; readonly tier: RoutedLayoutTier }
  | { readonly type: "close-drawer" }
  | {
      readonly type: "set-drawer-open";
      readonly open: boolean;
      readonly tier: RoutedLayoutTier;
    }
  | { readonly type: "tier-changed"; readonly tier: RoutedLayoutTier };

export function initialRoutedPaneOverlaysState(
  sidebarExpanded: boolean,
): RoutedPaneOverlaysState {
  return sidebarExpanded ? { status: "sidebar" } : { status: "closed" };
}

export function isRoutedSidebarExpanded(
  state: RoutedPaneOverlaysState,
): boolean {
  return state.status === "sidebar" || state.status === "sidebar-and-drawer";
}

export function isRoutedDrawerOpen(state: RoutedPaneOverlaysState): boolean {
  return state.status === "drawer" || state.status === "sidebar-and-drawer";
}

function overlaysStateFromFlags(
  sidebarExpanded: boolean,
  drawerOpen: boolean,
): RoutedPaneOverlaysState {
  if (sidebarExpanded && drawerOpen) {
    return { status: "sidebar-and-drawer" };
  }
  if (sidebarExpanded) {
    return { status: "sidebar" };
  }
  if (drawerOpen) {
    return { status: "drawer" };
  }
  return { status: "closed" };
}

export function transitionRoutedPaneOverlays(
  state: RoutedPaneOverlaysState,
  event: RoutedPaneOverlaysEvent,
): RoutedPaneOverlaysState {
  const sidebarExpanded = isRoutedSidebarExpanded(state);
  const drawerOpen = isRoutedDrawerOpen(state);

  switch (event.type) {
    case "toggle-sidebar": {
      const nextSidebar = !sidebarExpanded;
      const nextDrawer =
        nextSidebar && event.tier === "mobile" ? false : drawerOpen;
      return overlaysStateFromFlags(nextSidebar, nextDrawer);
    }
    case "close-sidebar":
      return overlaysStateFromFlags(false, drawerOpen);
    case "toggle-drawer": {
      const nextDrawer = !drawerOpen;
      const nextSidebar =
        nextDrawer && event.tier === "mobile" ? false : sidebarExpanded;
      return overlaysStateFromFlags(nextSidebar, nextDrawer);
    }
    case "close-drawer":
      return overlaysStateFromFlags(sidebarExpanded, false);
    case "set-drawer-open": {
      const nextSidebar =
        event.open && event.tier === "mobile" ? false : sidebarExpanded;
      return overlaysStateFromFlags(nextSidebar, event.open);
    }
    case "tier-changed":
      if (event.tier === "tablet") {
        return overlaysStateFromFlags(sidebarExpanded, false);
      }
      return overlaysStateFromFlags(false, drawerOpen);
  }
}
