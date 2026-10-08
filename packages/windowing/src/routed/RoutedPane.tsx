import { type ReactNode, useCallback, useMemo, useState } from "react";
import { useLauncherNavigationState } from "../launcher/LauncherNavigationProvider";
import {
  type LauncherDefinition,
  resolveLauncherHomeAppId,
  resolveLauncherOrder,
} from "../launcher/launcherDefinition";
import type { MiniAppBoundary } from "../launcher/MiniAppWindow";
import {
  type RoutedLayoutTier,
  useRoutedLayoutTier,
} from "../launcher/useRoutedLayoutTier";
import { WindowMenuProvider } from "../window/WindowMenuContext";
import {
  hasWindowSidebar,
  useWindowSidebar,
  WindowSidebarProvider,
} from "../window/WindowSidebarContext";
import "./RoutedPane.css";
import {
  type LauncherPlacement,
  loadLauncherPlacement,
  saveLauncherPlacement,
} from "./launcherPlacement";
import { RoutedPaneAppBar } from "./RoutedPaneAppBar";
import { RoutedPaneMain } from "./RoutedPaneMain";
import { RoutedPaneNav } from "./RoutedPaneNav";
import { RoutedPaneSidebar } from "./RoutedPaneSidebar";
import { RoutedPaneTaskBar } from "./RoutedPaneTaskBar";
import {
  type SubscribeKeyboardVisibility,
  useMobileKeyboardVisible,
} from "./useMobileKeyboardVisible";
import { invertBoolean, useRoutedPaneOverlays } from "./useRoutedPaneOverlays";

const DEFAULT_LAUNCHER_PLACEMENT_STORAGE_KEY = "windowing.launcherPlacement";

function PassThroughBoundary({ children }: { children?: ReactNode }) {
  return children;
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
  definition: LauncherDefinition,
  tier: RoutedLayoutTier,
  activeAppId: string,
): boolean {
  if (tier === "mobile") {
    return false;
  }

  return definition.apps[activeAppId]?.initialShowSidebar ?? true;
}

export interface RoutedPaneProps {
  /**
   * Wraps the active mini-app, such as an error boundary that fails inside the
   * app rather than the shell.
   */
  AppBoundary?: MiniAppBoundary | undefined;
  /**
   * The apps the launcher offers, in order, such as the definition's order less
   * the apps the session may not see. Defaults to the definition's order.
   */
  appIds?: ReadonlyArray<string> | undefined;
  /** Rides above the active app in the content pane. */
  contentTop?: ReactNode;
  /**
   * Where the tablet tier's launcher placement persists in localStorage.
   * Defaults to `windowing.launcherPlacement`.
   */
  launcherPlacementStorageKey?: string | undefined;
  /**
   * The taskbar's menu button, centered: the product's logo, which opens the
   * launcher sheet, or the rail on the tablet tier in side mode.
   */
  menuIcon: ReactNode;
  /**
   * A strip in its own row directly above the taskbar, such as a deployment
   * warning. It is told whether the phone's software keyboard is open, while
   * the taskbar itself hides.
   */
  renderAboveTaskbar?:
    | ((state: { keyboardVisible: boolean }) => ReactNode)
    | undefined;
  /** Native keyboard state, for a WebView whose resizing hides it. */
  subscribeKeyboardVisibility?: SubscribeKeyboardVisibility | undefined;
  /** The taskbar's end-aligned tray, such as the windowed/routed switch. */
  taskbarTray?: ReactNode;
}

interface RoutedPaneSurfaceProps
  extends Omit<
    RoutedPaneProps,
    "AppBoundary" | "appIds" | "launcherPlacementStorageKey"
  > {
  AppBoundary: MiniAppBoundary;
  activeAppId: string;
  appIds: ReadonlyArray<string>;
  launcherPlacement: LauncherPlacement;
  navigationRailExpanded: boolean;
  onToggleLauncherPlacement: (wasOpen: boolean) => void;
  onToggleNavigationRail: () => void;
  tier: RoutedLayoutTier;
}

function RoutedPaneSurface({
  activeAppId,
  AppBoundary,
  appIds,
  contentTop,
  launcherPlacement,
  menuIcon,
  navigationRailExpanded,
  onToggleLauncherPlacement,
  onToggleNavigationRail,
  renderAboveTaskbar,
  subscribeKeyboardVisibility,
  taskbarTray,
  tier,
}: RoutedPaneSurfaceProps) {
  const { definition } = useLauncherNavigationState();
  const { sidebar } = useWindowSidebar();
  const hasSidebar = hasWindowSidebar(sidebar);
  const mobileKeyboardVisible = useMobileKeyboardVisible(
    tier === "mobile",
    subscribeKeyboardVisibility,
  );

  const {
    closeDrawer,
    closeSidebar,
    dismissDrawer,
    drawerOpen,
    menuButtonRef,
    moveLauncher,
    sidebarExpanded,
    toggleDrawer,
    toggleSidebar,
  } = useRoutedPaneOverlays({
    initialSidebarExpanded: () =>
      initialRoutedSidebarExpanded(definition, tier, activeAppId),
    launcherPlacement,
    navigationRailExpanded,
    onToggleLauncherPlacement,
    tier,
  });
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
        appIds={appIds}
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
      <RoutedPaneMain
        activeAppId={activeAppId}
        AppBoundary={AppBoundary}
        contentTop={contentTop}
        tier={tier}
      />
      {renderAboveTaskbar && (
        <div className="routed-pane-above-taskbar">
          {renderAboveTaskbar({ keyboardVisible: mobileKeyboardVisible })}
        </div>
      )}
      <RoutedPaneTaskBar
        drawerOpen={drawerOpen}
        hidden={mobileKeyboardVisible}
        launcherPlacement={launcherPlacement}
        menuButtonRef={menuButtonRef}
        menuIcon={menuIcon}
        onToggleDrawer={toggleDrawer}
        onToggleRail={onToggleNavigationRail}
        railExpanded={navigationRailExpanded}
        tier={tier}
        tray={taskbarTray}
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

/**
 * The routed shell, the iPad / phone layout: one mini-app at a time, chosen by
 * the route, with an app bar, a launcher, and a taskbar. Render it inside a
 * {@link LauncherNavigationProvider} in `routed` mode, in a container that
 * gives it its size.
 *
 * Below 760px it is a phone layout whose launcher is a bottom sheet of tiles;
 * at or above it, a tablet layout whose launcher is a left rail or, at the
 * user's choice, the same sheet. The app's sidebar and toolbar actions, which
 * it registers with the window hooks, appear in the shell's sidebar and app
 * bar.
 */
export function RoutedPane({
  AppBoundary = PassThroughBoundary,
  appIds,
  launcherPlacementStorageKey = DEFAULT_LAUNCHER_PLACEMENT_STORAGE_KEY,
  ...props
}: RoutedPaneProps) {
  const tier = useRoutedLayoutTier();
  const {
    definition,
    route: { appId },
  } = useLauncherNavigationState();
  const [launcherPlacement, setLauncherPlacement] = useState<LauncherPlacement>(
    () => loadLauncherPlacement(launcherPlacementStorageKey),
  );
  const [navigationRailExpanded, setNavigationRailExpanded] = useState(false);
  // The route only ever names one of the launcher's apps, so the root route is
  // the one case that falls back to the home app.
  const activeAppId = appId ?? resolveLauncherHomeAppId(definition);
  const offeredAppIds = useMemo(
    () => appIds ?? resolveLauncherOrder(definition),
    [appIds, definition],
  );
  const toggleNavigationRail = useCallback(
    () => setNavigationRailExpanded(invertBoolean),
    [],
  );
  const toggleLauncherPlacement = useCallback(
    (wasOpen: boolean) => {
      const next = launcherPlacement === "side" ? "bottom" : "side";
      setNavigationRailExpanded(next === "side" && wasOpen);
      setLauncherPlacement(next);
      saveLauncherPlacement(launcherPlacementStorageKey, next);
    },
    [launcherPlacement, launcherPlacementStorageKey],
  );

  if (activeAppId === null) {
    return null;
  }

  return (
    <RoutedPaneWithRegistries
      key={activeAppId}
      {...props}
      AppBoundary={AppBoundary}
      activeAppId={activeAppId}
      appIds={offeredAppIds}
      launcherPlacement={launcherPlacement}
      navigationRailExpanded={navigationRailExpanded}
      onToggleLauncherPlacement={toggleLauncherPlacement}
      onToggleNavigationRail={toggleNavigationRail}
      tier={tier}
    />
  );
}
