import { TearleadsLogo } from "@tearleads/ui";
import {
  type ComponentType,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { LocalKeyringUnlockWindow } from "../../../mini-apps/LocalKeyringUnlockGate";
import { MINI_APPS } from "../../../mini-apps/registry";
import { SystemMonitorPinned } from "../../../mini-apps/system-monitor/SystemMonitorPinned";
import { useSystemMonitor } from "../../../mini-apps/system-monitor/SystemMonitorProvider";
import type { MiniAppId } from "../../../mini-apps/types";
import { useAppNavigationState } from "../../../navigation/AppNavigationProvider";
import {
  type RoutedLayoutTier,
  useRoutedLayoutTier,
} from "../../../navigation/useRoutedLayoutTier";
import { useCryptoSession } from "../../../providers/crypto/CryptoSessionProvider";
import { useIdentity } from "../../../providers/identity/IdentityProvider";
import { useLocalKeyringLock } from "../../../providers/local-keyring/LocalKeyringLockProvider";
import { useRegisterUserId } from "../../pane/dual-pane";
import { DestroyKeyPackageConfirmationDialog } from "../../shared/DestroyKeyPackageConfirmationDialog";
import { LogoutConfirmationDialog } from "../../shared/LogoutConfirmationDialog";
import type { MenuPosition } from "../../shared/Menu";
import { useDestroyKeyPackageConfirmation } from "../../shared/useDestroyKeyPackageConfirmation";
import { useConfirmedLogoutDialog } from "../../shared/useLogoutConfirmation";
import {
  useWindowFileMenuItems,
  useWindowViewMenuItems,
  WindowMenuProvider,
} from "../../window/WindowMenuContext";
import {
  useWindowSidebar,
  WindowSidebarProvider,
} from "../../window/WindowSidebarContext";
import "./RoutedPane.css";
import { RoutedPaneAppBar } from "./RoutedPaneAppBar";
import { RoutedPaneNav } from "./RoutedPaneNav";
import { RoutedPaneSidebar } from "./RoutedPaneSidebar";

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
  activeAppId: MiniAppId | null,
): boolean {
  if (tier === "mobile") {
    return false;
  }

  return activeAppId
    ? (MINI_APPS[activeAppId].initialShowSidebar ?? true)
    : true;
}

export function resolveRoutedActiveMiniAppId(
  routeAppId: MiniAppId | null,
): MiniAppId {
  const routeAppRegistered =
    routeAppId !== null && Object.hasOwn(MINI_APPS, routeAppId);

  return routeAppRegistered ? routeAppId : ROUTED_ROOT_MINI_APP_ID;
}

export function menuPositionBelow(anchor: HTMLElement): MenuPosition {
  const rect = anchor.getBoundingClientRect();
  return { x: rect.left, y: rect.bottom };
}

function RoutedPaneMobileBar({
  drawerOpen,
  onToggleDrawer,
}: {
  drawerOpen: boolean;
  onToggleDrawer: () => void;
}) {
  return (
    <footer className="routed-pane-mobile-bar">
      <button
        aria-controls="routed-pane-sheet"
        aria-expanded={drawerOpen}
        aria-label="Menu"
        className="routed-pane-mobile-menu-button"
        type="button"
        onClick={onToggleDrawer}
      >
        <TearleadsLogo className="routed-pane-mobile-menu-logo" />
      </button>
    </footer>
  );
}

// Reset the tier-specific overlays when the layout crosses the breakpoint
// (resize / rotation): the nav drawer only exists on mobile, and the expanded
// sidebar becomes a full-screen dialog on mobile, so neither should linger open
// into a tier where it would cover or no longer fit the content.
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

interface RoutedPaneSurfaceProps {
  activeAppId: MiniAppId;
  ActiveMiniApp: ComponentType;
  showUnlockPanel: boolean;
  navigationRailExpanded: boolean;
  onOpenUnlock: () => void;
  onToggleNavigationRail: () => void;
  tier: RoutedLayoutTier;
}

function RoutedPaneConfirmationDialogs({
  destroyKeyPackageDialog,
  logoutDialog,
}: {
  destroyKeyPackageDialog: ReturnType<typeof useDestroyKeyPackageConfirmation>;
  logoutDialog: ReturnType<typeof useConfirmedLogoutDialog>;
}) {
  return (
    <>
      {destroyKeyPackageDialog.isOpen && (
        <DestroyKeyPackageConfirmationDialog
          isOpen={destroyKeyPackageDialog.isOpen}
          onCancel={destroyKeyPackageDialog.closeDestroyKeyPackageDialog}
          onConfirm={destroyKeyPackageDialog.confirmDestroyKeyPackage}
        />
      )}
      {logoutDialog.isOpen && (
        <LogoutConfirmationDialog
          busy={logoutDialog.busy}
          isOpen={logoutDialog.isOpen}
          onCancel={logoutDialog.closeLogoutDialog}
          onConfirm={logoutDialog.confirmLogout}
        />
      )}
    </>
  );
}

function RoutedPaneSurface({
  activeAppId,
  ActiveMiniApp,
  showUnlockPanel,
  navigationRailExpanded,
  onOpenUnlock,
  onToggleNavigationRail,
  tier,
}: RoutedPaneSurfaceProps) {
  const { sidebar } = useWindowSidebar();
  const logoutDialog = useConfirmedLogoutDialog();
  const { destroyKey } = useIdentity();
  const { isDeveloperMode } = useSystemMonitor();
  const destroyKeyPackageDialog = useDestroyKeyPackageConfirmation(destroyKey);
  const hasSidebar =
    sidebar !== null && sidebar !== undefined && sidebar !== false;

  const fileMenuItems = useWindowFileMenuItems();
  const viewMenuItems = useWindowViewMenuItems();
  const menuItems = useMemo(
    () => [...fileMenuItems, ...viewMenuItems],
    [fileMenuItems, viewMenuItems],
  );

  const [sidebarExpanded, setSidebarExpanded] = useState(() =>
    initialRoutedSidebarExpanded(tier, activeAppId),
  );
  const [drawerOpen, setDrawerOpen] = useState(false);

  const toggleSidebar = useCallback(
    () => setSidebarExpanded(invertBoolean),
    [],
  );
  const closeSidebar = useCallback(() => setSidebarExpanded(false), []);
  const toggleDrawer = useCallback(() => setDrawerOpen(invertBoolean), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  useCollapseOverlaysOnTierChange({ closeDrawer, closeSidebar, tier });

  const sidebarVisible = hasSidebar && sidebarExpanded;

  return (
    <section
      className={`routed-pane routed-pane--${tier}`}
      data-sidebar={sidebarVisible ? "open" : "closed"}
      role="application"
    >
      <RoutedPaneAppBar
        activeAppId={activeAppId}
        hasSidebar={hasSidebar}
        onToggleSidebar={toggleSidebar}
        sidebarExpanded={sidebarExpanded}
      />
      <RoutedPaneNav
        activeAppId={activeAppId}
        drawerOpen={drawerOpen}
        menuItems={menuItems}
        onCloseDrawer={closeDrawer}
        onOpenUnlock={onOpenUnlock}
        onRequestDestroyKeyPackage={
          destroyKeyPackageDialog.requestDestroyKeyPackage
        }
        onRequestLogout={logoutDialog.requestLogout}
        onToggleRail={onToggleNavigationRail}
        railExpanded={navigationRailExpanded}
        showDeveloperControls={isDeveloperMode}
        tier={tier}
      />
      {sidebarVisible && (
        <RoutedPaneSidebar onClose={closeSidebar} tier={tier}>
          {sidebar}
        </RoutedPaneSidebar>
      )}
      <main className="routed-pane-main">
        {/* When the developer pins the System Monitor it rides above the active
            app in both routed tiers, replacing the pinned-monitor slot the old
            home launcher used to host. Renders nothing unless pinned. */}
        <SystemMonitorPinned />
        {showUnlockPanel ? <LocalKeyringUnlockWindow /> : <ActiveMiniApp />}
      </main>
      {tier === "mobile" && (
        <RoutedPaneMobileBar
          drawerOpen={drawerOpen}
          onToggleDrawer={toggleDrawer}
        />
      )}
      <RoutedPaneConfirmationDialogs
        destroyKeyPackageDialog={destroyKeyPackageDialog}
        logoutDialog={logoutDialog}
      />
    </section>
  );
}

function RoutedPaneWithRegistries({
  activeAppId,
  ActiveMiniApp,
  navigationRailExpanded,
  onToggleNavigationRail,
  tier,
}: {
  activeAppId: MiniAppId;
  ActiveMiniApp: ComponentType;
  navigationRailExpanded: boolean;
  onToggleNavigationRail: () => void;
  tier: RoutedLayoutTier;
}) {
  const localKeyringLock = useLocalKeyringLock();
  const [showUnlockPanel, setShowUnlockPanel] = useState(false);
  const openUnlockPanel = useCallback(() => setShowUnlockPanel(true), []);

  useEffect(() => {
    if (!localKeyringLock.isLocked) {
      setShowUnlockPanel(false);
    }
  }, [localKeyringLock.isLocked]);

  return (
    <WindowMenuProvider>
      <WindowSidebarProvider>
        <RoutedPaneSurface
          activeAppId={activeAppId}
          ActiveMiniApp={ActiveMiniApp}
          navigationRailExpanded={navigationRailExpanded}
          showUnlockPanel={showUnlockPanel}
          tier={tier}
          onOpenUnlock={openUnlockPanel}
          onToggleNavigationRail={onToggleNavigationRail}
        />
      </WindowSidebarProvider>
    </WindowMenuProvider>
  );
}

export function RoutedPane() {
  const { userId } = useCryptoSession();
  const tier = useRoutedLayoutTier();
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

  return (
    <RoutedPaneWithRegistries
      key={activeAppId}
      activeAppId={activeAppId}
      ActiveMiniApp={ActiveMiniApp}
      navigationRailExpanded={navigationRailExpanded}
      tier={tier}
      onToggleNavigationRail={toggleNavigationRail}
    />
  );
}
