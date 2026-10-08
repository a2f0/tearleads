import type { ReactNode, RefObject } from "react";
import type { RoutedLayoutTier } from "../launcher/useRoutedLayoutTier";
import type { LauncherPlacement } from "./launcherPlacement";
import { ROUTED_PANE_NAV_PANEL_ID } from "./RoutedPaneNav";

interface RoutedPaneTaskBarProps {
  drawerOpen: boolean;
  hidden: boolean;
  launcherPlacement: LauncherPlacement;
  menuButtonRef: RefObject<HTMLButtonElement | null>;
  menuIcon: ReactNode;
  onToggleDrawer: () => void;
  onToggleRail: () => void;
  railExpanded: boolean;
  tier: RoutedLayoutTier;
  tray: ReactNode;
}

/**
 * The routed shell's bottom taskbar — the routed counterpart of a desktop's
 * taskbar. Present in both tiers: the centered menu icon opens the launcher
 * sheet on mobile or in bottom mode, and reveals the rail in tablet side mode.
 * The corner hosts the tray. On mobile it hides while a text-editing control
 * has focus to leave room for the software keyboard.
 */
export function RoutedPaneTaskBar({
  drawerOpen,
  hidden,
  launcherPlacement,
  menuButtonRef,
  menuIcon,
  onToggleDrawer,
  onToggleRail,
  railExpanded,
  tier,
  tray,
}: RoutedPaneTaskBarProps) {
  const usesSheet = tier === "mobile" || launcherPlacement === "bottom";
  const expanded = usesSheet ? drawerOpen : railExpanded;
  // The launcher sheet stays mounted (just hidden), so keep its disclosure
  // relationship wired regardless of open state. The tablet rail's
  // nav panel only exists while expanded, so reference it only then (mirroring
  // the rail toggle) rather than pointing aria-controls at an absent element.
  const controls = usesSheet
    ? "routed-pane-sheet"
    : expanded
      ? ROUTED_PANE_NAV_PANEL_ID
      : undefined;

  return (
    <footer className="routed-pane-taskbar" hidden={hidden}>
      <button
        aria-controls={controls}
        aria-expanded={expanded}
        aria-label="Menu"
        className="routed-pane-taskbar-menu-button"
        ref={menuButtonRef}
        type="button"
        onClick={usesSheet ? onToggleDrawer : onToggleRail}
      >
        {menuIcon}
      </button>
      <div className="routed-pane-taskbar-end">{tray}</div>
    </footer>
  );
}
