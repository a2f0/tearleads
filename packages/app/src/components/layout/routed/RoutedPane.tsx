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

function invertBoolean(value: boolean): boolean {
  return !value;
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

function RoutedPaneSurface({
  activeAppId,
  ActiveMiniApp,
  showUnlockPanel,
  onOpenUnlock,
}: {
  activeAppId: MiniAppId | null;
  ActiveMiniApp: ComponentType | null;
  showUnlockPanel: boolean;
  onOpenUnlock: () => void;
}) {
  const tier = useRoutedLayoutTier();
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
    activeAppId ? (MINI_APPS[activeAppId].initialShowSidebar ?? true) : true,
  );
  const [drawerOpen, setDrawerOpen] = useState(false);

  const toggleSidebar = useCallback(
    () => setSidebarExpanded(invertBoolean),
    [],
  );
  const closeSidebar = useCallback(() => setSidebarExpanded(false), []);
  const toggleDrawer = useCallback(() => setDrawerOpen(invertBoolean), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  // The drawer is mobile-only; collapse it whenever we land on the tablet rail.
  useEffect(() => {
    if (tier === "tablet") {
      setDrawerOpen(false);
    }
  }, [tier]);

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
}: {
  activeAppId: MiniAppId | null;
  ActiveMiniApp: ComponentType | null;
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
          onOpenUnlock={openUnlockPanel}
        />
      </WindowSidebarProvider>
    </WindowMenuProvider>
  );
}

export function RoutedPane() {
  const { userId } = useCryptoSession();
  const {
    route: { appId },
  } = useAppNavigationState();
  useRegisterUserId(userId);
  const ActiveMiniApp = useMemo(
    () => (appId ? MINI_APPS[appId].createComponent() : null),
    [appId],
  );

  return (
    <RoutedPaneWithRegistries
      key={appId ?? "home"}
      activeAppId={appId}
      ActiveMiniApp={ActiveMiniApp}
    />
  );
}
