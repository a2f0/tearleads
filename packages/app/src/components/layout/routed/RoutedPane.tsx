import {
  type ComponentType,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useMemo,
} from "react";
import { LocalKeyringUnlockWindow } from "../../../mini-apps/LocalKeyringUnlockGate";
import { MINI_APP_MENU_ITEMS, MINI_APPS } from "../../../mini-apps/registry";
import type { MiniAppId } from "../../../mini-apps/types";
import {
  useAppNavigationActions,
  useAppNavigationState,
} from "../../../navigation/AppNavigationProvider";
import { useCryptoSession } from "../../../providers/crypto/CryptoSessionProvider";
import { useIdentity } from "../../../providers/identity/IdentityProvider";
import { useLocalKeyringLock } from "../../../providers/local-keyring/LocalKeyringLockProvider";
import { useRegisterUserId } from "../../pane/DualPaneProvider";
import { PaneLog } from "../../pane/PaneLog";
import { PaneStatus } from "../../pane/PaneStatus";
import { MiniAppButton } from "../../shared/MiniAppLayout";
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

const BOOT_PANE_LOG_MESSAGE = "Generate a key pair to boot this pane.";
const LOCKED_PANE_LOG_MESSAGE =
  "Unlock the local keychain to restore this pane.";

function RoutedPaneHome() {
  const { openMiniApp } = useAppNavigationActions();
  const { generateKey, signingKeyPair } = useIdentity();
  const localKeyringLock = useLocalKeyringLock();
  const paneLocked = localKeyringLock.isLocked && !signingKeyPair;
  const bootPaneLogEntry = useMemo(
    () => ({
      id: "boot-pane-prompt",
      level: "info" as const,
      timestamp: Date.now(),
      message: paneLocked ? LOCKED_PANE_LOG_MESSAGE : BOOT_PANE_LOG_MESSAGE,
    }),
    [paneLocked],
  );
  const trailingLogEntries = useMemo(
    () => (signingKeyPair ? [] : [bootPaneLogEntry]),
    [bootPaneLogEntry, signingKeyPair],
  );

  return (
    <div className="routed-pane-home">
      <PaneStatus />
      {paneLocked ? (
        <LocalKeyringUnlockWindow />
      ) : signingKeyPair ? (
        <div className="routed-pane-launcher">
          {MINI_APP_MENU_ITEMS.map(({ appId, label }) => (
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
      <PaneLog trailingEntries={trailingLogEntries} />
    </div>
  );
}

function RoutedPaneNavButton({
  appId,
  activeAppId,
}: {
  appId: MiniAppId;
  activeAppId: MiniAppId | null;
}) {
  const { getMiniAppHref, openMiniApp } = useAppNavigationActions();
  const handleClick = useCallback(
    (event: ReactMouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      openMiniApp({ appId });
    },
    [appId, openMiniApp],
  );

  return (
    <a
      aria-current={activeAppId === appId ? "page" : undefined}
      className={
        activeAppId === appId
          ? "routed-pane-nav-link routed-pane-nav-link--active"
          : "routed-pane-nav-link"
      }
      href={getMiniAppHref(appId)}
      onClick={handleClick}
    >
      {MINI_APPS[appId].title}
    </a>
  );
}

function RoutedPaneToolbar({ activeAppId }: { activeAppId: MiniAppId | null }) {
  const { goBack, goForward } = useAppNavigationActions();
  const { history } = useAppNavigationState();
  const fileMenuItems = useWindowFileMenuItems();
  const viewMenuItems = useWindowViewMenuItems();
  const menuItems = useMemo(
    () => [...fileMenuItems, ...viewMenuItems],
    [fileMenuItems, viewMenuItems],
  );

  return (
    <div className="routed-pane-toolbar">
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
      <nav aria-label="Apps" className="routed-pane-nav">
        {MINI_APP_MENU_ITEMS.map(({ appId }) => (
          <RoutedPaneNavButton
            key={appId}
            activeAppId={activeAppId}
            appId={appId}
          />
        ))}
      </nav>
      {menuItems.length > 0 && (
        <div className="routed-pane-actions">
          {menuItems.map((item) => (
            <button
              key={item.id}
              disabled={item.disabled}
              type="button"
              onClick={item.onClick}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function RoutedPaneSurface({
  activeAppId,
  ActiveMiniApp,
}: {
  activeAppId: MiniAppId | null;
  ActiveMiniApp: ComponentType | null;
}) {
  const { sidebar } = useWindowSidebar();
  const hasSidebar =
    sidebar !== null && sidebar !== undefined && sidebar !== false;

  return (
    <section className="routed-pane" role="application">
      <RoutedPaneToolbar activeAppId={activeAppId} />
      {hasSidebar && <div className="routed-pane-sidebar">{sidebar}</div>}
      <main className="routed-pane-main">
        {ActiveMiniApp ? <ActiveMiniApp /> : <RoutedPaneHome />}
      </main>
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
  return (
    <WindowMenuProvider>
      <WindowSidebarProvider>
        <RoutedPaneSurface
          activeAppId={activeAppId}
          ActiveMiniApp={ActiveMiniApp}
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
