import { TearleadsLogo } from "@tearleads/ui";
import {
  type ComponentType,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { MINI_APPS } from "../../../mini-apps/registry";
import { SystemMonitorPinned } from "../../../mini-apps/system-monitor/SystemMonitorPinned";
import type { MiniAppId } from "../../../mini-apps/types";
import { useAppNavigationState } from "../../../navigation/AppNavigationProvider";
import { NavigationModeSwitch } from "../../../navigation/NavigationModeSwitch";
import {
  type RoutedLayoutTier,
  useRoutedLayoutTier,
} from "../../../navigation/useRoutedLayoutTier";
import { useCryptoSession } from "../../../providers/crypto/CryptoSessionProvider";
import { useAppHostConfig } from "../../../providers/host/AppHostConfigProvider";
import { MiniAppBoundary } from "../../mini-app/MiniAppBoundary";
import { useRegisterUserId } from "../../pane/dual-pane";
import { SyncStatusIndicator } from "../../pane/footer/sync-status/SyncStatusIndicator";
import { WindowMenuProvider } from "../../window/WindowMenuContext";
import {
  hasWindowSidebar,
  useWindowSidebar,
  WindowSidebarProvider,
} from "../../window/WindowSidebarContext";
import { TestSystemBanner } from "../TestSystemBanner";
import "./RoutedPane.css";
import {
  type LauncherPlacement,
  loadLauncherPlacement,
  saveLauncherPlacement,
} from "./LauncherPlacement";
import { RoutedPaneAppBar } from "./RoutedPaneAppBar";
import { ROUTED_PANE_NAV_PANEL_ID, RoutedPaneNav } from "./RoutedPaneNav";
import { RoutedPaneOverlayHostProvider } from "./RoutedPaneOverlayHost";
import { RoutedPaneSidebar } from "./RoutedPaneSidebar";
import { useMobileKeyboardVisible } from "./useMobileKeyboardVisible";

const ROUTED_ROOT_MINI_APP_ID: MiniAppId = "explorer";

function invertBoolean(value: boolean): boolean {
  return !value;
}

/**
 * Whether a freshly mounted routed mini-app shows its sidebar.
 *
 * On mobile the sidebar is a dismissable overlay (dialog + scrim), so it must
 * never open on its own when an app loads — it starts collapsed and the user
 * reveals it from the app bar. The tablet rail honours each app's configured
 * {@link MiniAppDefinition.initialShowSidebar} default (defaulting to shown).
 */
export function initialRoutedSidebarExpanded(
  tier: RoutedLayoutTier,
  activeAppId: MiniAppId,
): boolean {
  if (tier === "mobile") {
    return false;
  }

  return MINI_APPS[activeAppId].initialShowSidebar ?? true;
}

export function resolveRoutedActiveMiniAppId(
  routeAppId: MiniAppId | null,
): MiniAppId {
  // parseAppRoute only produces registered ids, so null (the root route) is the
  // sole fallback case.
  return routeAppId ?? ROUTED_ROOT_MINI_APP_ID;
}

/**
 * The routed shell's bottom taskbar — the routed counterpart of the windowed
 * pane footer. Present in both tiers: the centered Tearleads logo is the menu
 * affordance (opening the launcher sheet on mobile or in bottom mode, revealing
 * the rail in tablet side mode). The corner hosts the windowed/routed switch.
 * On mobile it hides while a text-editing control has focus to leave room for
 * the software keyboard.
 */
function RoutedPaneTaskBar({
  tier,
  launcherPlacement,
  hidden,
  drawerOpen,
  menuButtonRef,
  onToggleDrawer,
  railExpanded,
  onToggleRail,
}: {
  tier: RoutedLayoutTier;
  launcherPlacement: LauncherPlacement;
  hidden: boolean;
  drawerOpen: boolean;
  menuButtonRef: RefObject<HTMLButtonElement | null>;
  onToggleDrawer: () => void;
  railExpanded: boolean;
  onToggleRail: () => void;
}) {
  const { navigationMode } = useAppHostConfig();
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
        <TearleadsLogo className="routed-pane-taskbar-menu-logo" />
      </button>
      <div className="routed-pane-taskbar-end">
        <NavigationModeSwitch
          allowWindowed={navigationMode === "windowed"}
          mode="routed"
        />
        <SyncStatusIndicator />
      </div>
    </footer>
  );
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

interface RoutedPaneSurfaceProps {
  activeAppId: MiniAppId;
  ActiveMiniApp: ComponentType;
  launcherPlacement: LauncherPlacement;
  navigationRailExpanded: boolean;
  onToggleLauncherPlacement: () => void;
  onToggleNavigationRail: () => void;
  tier: RoutedLayoutTier;
}

function RoutedPaneSurface({
  activeAppId,
  ActiveMiniApp,
  launcherPlacement,
  navigationRailExpanded,
  onToggleLauncherPlacement,
  onToggleNavigationRail,
  tier,
}: RoutedPaneSurfaceProps) {
  const { sidebar } = useWindowSidebar();
  const { subscribeKeyboardVisibility } = useAppHostConfig();
  const hasSidebar = hasWindowSidebar(sidebar);
  const mobileKeyboardVisible = useMobileKeyboardVisible(
    tier === "mobile",
    subscribeKeyboardVisibility,
  );

  const [sidebarExpanded, setSidebarExpanded] = useState(() =>
    initialRoutedSidebarExpanded(tier, activeAppId),
  );
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  // Held in state rather than a ref so the overlays that portal into the pane
  // re-render once it is on screen. The ref callback runs in the commit phase
  // and this update flushes before paint, so the pane is already the host by the
  // first frame any overlay inside it can be opened on.
  const [overlayHost, setOverlayHost] = useState<HTMLElement | null>(null);
  const overlayHostValue = useMemo(
    () => ({ host: overlayHost, tier }),
    [overlayHost, tier],
  );

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
  const moveLauncher = useCallback(() => {
    closeDrawer();
    onToggleLauncherPlacement();
  }, [closeDrawer, onToggleLauncherPlacement]);

  useCollapseOverlaysOnTierChange({ closeDrawer, closeSidebar, tier });

  const sidebarVisible = hasSidebar && sidebarExpanded;

  return (
    <section
      className={`routed-pane routed-pane--${tier}`}
      data-keyboard={mobileKeyboardVisible ? "open" : "closed"}
      data-launcher-placement={launcherPlacement}
      data-sidebar={sidebarVisible ? "open" : "closed"}
      role="application"
    >
      <RoutedPaneAppBar
        activeAppId={activeAppId}
        hasSidebar={hasSidebar}
        onToggleSidebar={toggleSidebar}
        sidebarExpanded={sidebarExpanded}
        tier={tier}
      />
      <RoutedPaneNav
        activeAppId={activeAppId}
        drawerOpen={drawerOpen}
        launcherPlacement={launcherPlacement}
        onCloseDrawer={dismissDrawer}
        onNavigateRail={closeDrawer}
        onToggleLauncherPlacement={moveLauncher}
        onToggleRail={onToggleNavigationRail}
        railExpanded={navigationRailExpanded}
        tier={tier}
      />
      {sidebarVisible && (
        <RoutedPaneSidebar onClose={closeSidebar} tier={tier}>
          {sidebar}
        </RoutedPaneSidebar>
      )}
      {/* Programmatically focusable (`tabIndex={-1}`, so never in the tab
          order), like a window's content pane: an overlay that covered it lands
          focus here when whatever opened the overlay is gone by the time it
          closes. Passing the setter itself as the ref keeps its identity stable
          across renders — an inline callback would detach and reattach the host
          on every one. */}
      <main className="routed-pane-main" ref={setOverlayHost} tabIndex={-1}>
        {/* Offered to overlays that fill the content pane instead of the screen
            — the note attachment preview, and the image viewer on tablet — so
            they leave the rail, app bar, and taskbar on screen beside them. */}
        <RoutedPaneOverlayHostProvider value={overlayHostValue}>
          {/* When the developer pins the System Monitor it rides above the active
              app in both routed tiers, replacing the pinned-monitor slot the old
              home launcher used to host. Renders nothing unless pinned. */}
          <SystemMonitorPinned />
          <MiniAppBoundary appId={activeAppId}>
            <ActiveMiniApp />
          </MiniAppBoundary>
        </RoutedPaneOverlayHostProvider>
      </main>
      <TestSystemBanner hidden={mobileKeyboardVisible} />
      <RoutedPaneTaskBar
        drawerOpen={drawerOpen}
        hidden={mobileKeyboardVisible}
        launcherPlacement={launcherPlacement}
        menuButtonRef={menuButtonRef}
        onToggleDrawer={toggleDrawer}
        onToggleRail={onToggleNavigationRail}
        railExpanded={navigationRailExpanded}
        tier={tier}
      />
    </section>
  );
}

/**
 * Hosts the per-app chrome registries (toolbar actions and the mini-app
 * sidebar). Keyed by the active app id upstream so each mini-app mounts against
 * fresh registries.
 */
function RoutedPaneWithRegistries(props: RoutedPaneSurfaceProps) {
  return (
    <WindowMenuProvider>
      <WindowSidebarProvider>
        <RoutedPaneSurface {...props} />
      </WindowSidebarProvider>
    </WindowMenuProvider>
  );
}

export function RoutedPane() {
  const { userId } = useCryptoSession();
  const tier = useRoutedLayoutTier();
  const [launcherPlacement, setLauncherPlacement] = useState<LauncherPlacement>(
    loadLauncherPlacement,
  );
  const [navigationRailExpanded, setNavigationRailExpanded] = useState(false);
  const {
    route: { appId },
  } = useAppNavigationState();
  useRegisterUserId(userId);
  const activeAppId = resolveRoutedActiveMiniAppId(appId);
  const ActiveMiniApp = useMemo(
    () => MINI_APPS[activeAppId].createComponent(),
    [activeAppId],
  );
  const toggleNavigationRail = useCallback(
    () => setNavigationRailExpanded(invertBoolean),
    [],
  );
  const toggleLauncherPlacement = useCallback(() => {
    setNavigationRailExpanded(false);
    const next = launcherPlacement === "side" ? "bottom" : "side";
    setLauncherPlacement(next);
    saveLauncherPlacement(next);
  }, [launcherPlacement]);

  return (
    <RoutedPaneWithRegistries
      key={activeAppId}
      activeAppId={activeAppId}
      ActiveMiniApp={ActiveMiniApp}
      launcherPlacement={launcherPlacement}
      navigationRailExpanded={navigationRailExpanded}
      onToggleLauncherPlacement={toggleLauncherPlacement}
      tier={tier}
      onToggleNavigationRail={toggleNavigationRail}
    />
  );
}
