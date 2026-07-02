import {
  type ComponentType,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { LocalKeyringUnlockWindow } from "../../../mini-apps/LocalKeyringUnlockGate";
import {
  MINI_APPS,
  ROUTED_MINI_APP_NAV_ITEMS,
} from "../../../mini-apps/registry";
import { useSystemMonitor } from "../../../mini-apps/system-monitor/SystemMonitorProvider";
import type { MiniAppId } from "../../../mini-apps/types";
import {
  useAppNavigationActions,
  useAppNavigationState,
} from "../../../navigation/AppNavigationProvider";
import {
  type RoutedLayoutTier,
  useRoutedLayoutTier,
} from "../../../navigation/useRoutedLayoutTier";
import { useCryptoSession } from "../../../providers/crypto/CryptoSessionProvider";
import { useIdentity } from "../../../providers/identity/IdentityProvider";
import { useLocalKeyringLock } from "../../../providers/local-keyring/LocalKeyringLockProvider";
import { useRegisterUserId } from "../../pane/DualPaneProvider";
import { useBootPaneLogEntries } from "../../pane/log/useBootPaneLogEntries";
import { PaneLog } from "../../pane/PaneLog";
import { PaneStatus } from "../../pane/PaneStatus";
import { DestroyKeyPackageConfirmationDialog } from "../../shared/DestroyKeyPackageConfirmationDialog";
import { LogoutConfirmationDialog } from "../../shared/LogoutConfirmationDialog";
import type { MenuPosition } from "../../shared/Menu";
import { MiniAppButton } from "../../shared/MiniAppLayout";
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
import { RoutedPaneNav } from "./RoutedPaneNav";

const BOOT_PANE_LOG_MESSAGE = "Generate a key pair to boot this pane.";
const MOBILE_ROOT_MINI_APP_ID: MiniAppId = "explorer";

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
  tier: RoutedLayoutTier,
  routeAppId: MiniAppId | null,
): MiniAppId | null {
  const routeAppRegistered =
    routeAppId !== null && Object.hasOwn(MINI_APPS, routeAppId);

  if (routeAppRegistered) {
    return routeAppId;
  }

  return tier === "mobile" ? MOBILE_ROOT_MINI_APP_ID : null;
}

function RoutedPaneHome() {
  const { openMiniApp } = useAppNavigationActions();
  const { generateKey, signingKeyPair } = useIdentity();
  const { isPinned } = useSystemMonitor();
  const localKeyringLock = useLocalKeyringLock();
  const paneLocked = localKeyringLock.isLocked && !signingKeyPair;
  const trailingLogEntries = useBootPaneLogEntries({
    bootMessage: BOOT_PANE_LOG_MESSAGE,
    hasSigningKeyPair: signingKeyPair !== null,
    paneLocked,
  });

  return (
    <div className="routed-pane-home">
      {isPinned && <PaneStatus />}
      {paneLocked ? (
        <LocalKeyringUnlockWindow />
      ) : signingKeyPair ? (
        <div className="routed-pane-launcher">
          {ROUTED_MINI_APP_NAV_ITEMS.map(({ appId, label }) => (
            <MiniAppButton key={appId} onClick={() => openMiniApp({ appId })}>
              {label}
            </MiniAppButton>
          ))}
        </div>
      ) : (
        <div className="routed-pane-launcher">
          <MiniAppButton onClick={generateKey}>Generate Key Pair</MiniAppButton>
        </div>
      )}
      {isPinned && <PaneLog trailingEntries={trailingLogEntries} />}
    </div>
  );
}

export function menuPositionBelow(anchor: HTMLElement): MenuPosition {
  const rect = anchor.getBoundingClientRect();
  return { x: rect.left, y: rect.bottom };
}

/**
 * The navigation surface shared by both tiers: app links, the system ("Pane")
 * menu items, and any file/view actions. Rendered as the persistent left rail
 * on tablet and as the slide-in drawer body on mobile.
 */
function RoutedPaneAppBar({
  activeAppId,
  hasSidebar,
  onToggleDrawer,
  onToggleSidebar,
  sidebarExpanded,
  tier,
}: {
  activeAppId: MiniAppId | null;
  hasSidebar: boolean;
  onToggleDrawer: () => void;
  onToggleSidebar: () => void;
  sidebarExpanded: boolean;
  tier: RoutedLayoutTier;
}) {
  const { goBack, goForward } = useAppNavigationActions();
  const { history } = useAppNavigationState();

  return (
    <header className="routed-pane-appbar">
      {tier === "mobile" && (
        <button
          aria-controls="routed-pane-drawer"
          aria-label="Menu"
          className="routed-pane-iconbutton routed-pane-hamburger"
          type="button"
          onClick={onToggleDrawer}
        >
          <span aria-hidden="true">☰</span>
        </button>
      )}
      <div className="routed-pane-title">
        {activeAppId ? MINI_APPS[activeAppId].title : "Home"}
      </div>
      <div className="routed-pane-appbar-spacer" />
      <div className="routed-pane-history-controls">
        <button
          aria-label="Back"
          disabled={!history.canGoBack}
          type="button"
          onClick={goBack}
        >
          Back
        </button>
        <button
          aria-label="Forward"
          disabled={!history.canGoForward}
          type="button"
          onClick={goForward}
        >
          Forward
        </button>
      </div>
      {hasSidebar && (
        <button
          aria-controls="routed-pane-sidebar"
          aria-expanded={sidebarExpanded}
          className="routed-pane-iconbutton"
          type="button"
          onClick={onToggleSidebar}
        >
          {sidebarExpanded ? "Hide Sidebar" : "Show Sidebar"}
        </button>
      )}
    </header>
  );
}

/**
 * The active mini-app's sidebar: a rail column beside main on tablet, or a
 * dismissable overlay (with scrim) on mobile.
 */
function RoutedPaneSidebar({
  children,
  onClose,
  tier,
}: {
  children: ReactNode;
  onClose: () => void;
  tier: RoutedLayoutTier;
}) {
  return (
    <>
      {tier === "mobile" && (
        <button
          aria-label="Close sidebar"
          className="routed-pane-scrim"
          type="button"
          onClick={onClose}
        />
      )}
      <div
        className="routed-pane-sidebar"
        id="routed-pane-sidebar"
        role={tier === "mobile" ? "dialog" : undefined}
      >
        {children}
      </div>
    </>
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

function RoutedPaneSurface({
  activeAppId,
  ActiveMiniApp,
  showUnlockPanel,
  onOpenUnlock,
  tier,
}: {
  activeAppId: MiniAppId | null;
  ActiveMiniApp: ComponentType | null;
  showUnlockPanel: boolean;
  onOpenUnlock: () => void;
  tier: RoutedLayoutTier;
}) {
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
        onToggleDrawer={toggleDrawer}
        onToggleSidebar={toggleSidebar}
        sidebarExpanded={sidebarExpanded}
        tier={tier}
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
        showDeveloperControls={isDeveloperMode}
        tier={tier}
      />
      {sidebarVisible && (
        <RoutedPaneSidebar onClose={closeSidebar} tier={tier}>
          {sidebar}
        </RoutedPaneSidebar>
      )}
      <main className="routed-pane-main">
        {showUnlockPanel ? (
          <LocalKeyringUnlockWindow />
        ) : ActiveMiniApp ? (
          <ActiveMiniApp />
        ) : (
          <RoutedPaneHome />
        )}
      </main>
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
    </section>
  );
}

function RoutedPaneWithRegistries({
  activeAppId,
  ActiveMiniApp,
  tier,
}: {
  activeAppId: MiniAppId | null;
  ActiveMiniApp: ComponentType | null;
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
          showUnlockPanel={showUnlockPanel}
          tier={tier}
          onOpenUnlock={openUnlockPanel}
        />
      </WindowSidebarProvider>
    </WindowMenuProvider>
  );
}

export function RoutedPane() {
  const { userId } = useCryptoSession();
  const tier = useRoutedLayoutTier();
  const {
    route: { appId },
  } = useAppNavigationState();
  useRegisterUserId(userId);
  const activeAppId = resolveRoutedActiveMiniAppId(tier, appId);
  const ActiveMiniApp = useMemo(
    () => (activeAppId ? MINI_APPS[activeAppId].createComponent() : null),
    [activeAppId],
  );

  return (
    <RoutedPaneWithRegistries
      key={activeAppId ?? "home"}
      activeAppId={activeAppId}
      ActiveMiniApp={ActiveMiniApp}
      tier={tier}
    />
  );
}
