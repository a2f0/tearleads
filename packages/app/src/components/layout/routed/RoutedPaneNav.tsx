import { type MouseEvent as ReactMouseEvent, useCallback } from "react";
import {
  MINI_APPS,
  ROUTED_MINI_APP_NAV_ITEMS,
} from "../../../mini-apps/registry";
import type { MiniAppId } from "../../../mini-apps/types";
import { useAppNavigationActions } from "../../../navigation/AppNavigationProvider";
import type { RoutedLayoutTier } from "../../../navigation/useRoutedLayoutTier";
import { PaneSystemMenuItems } from "../../shared/PaneSystemMenuItems";
import type { WindowMenuItem } from "../../window/WindowMenuBar";

function RoutedPaneNavLink({
  appId,
  activeAppId,
  onNavigate,
}: {
  appId: MiniAppId;
  activeAppId: MiniAppId | null;
  onNavigate: () => void;
}) {
  const { getMiniAppHref, openMiniApp } = useAppNavigationActions();
  const handleClick = useCallback(
    (event: ReactMouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      openMiniApp({ appId });
      onNavigate();
    },
    [appId, onNavigate, openMiniApp],
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

function RoutedPaneHomeNavLink({
  activeAppId,
  onNavigate,
}: {
  activeAppId: MiniAppId | null;
  onNavigate: () => void;
}) {
  const { getHomeHref, navigateHome } = useAppNavigationActions();
  const handleClick = useCallback(
    (event: ReactMouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      navigateHome();
      onNavigate();
    },
    [navigateHome, onNavigate],
  );

  return (
    <a
      aria-current={activeAppId === null ? "page" : undefined}
      className={
        activeAppId === null
          ? "routed-pane-nav-link routed-pane-nav-link--active"
          : "routed-pane-nav-link"
      }
      href={getHomeHref()}
      onClick={handleClick}
    >
      Home
    </a>
  );
}

/**
 * The navigation surface shared by both tiers: app links, the system ("Pane")
 * menu items, and any file/view actions.
 */
function RoutedPaneNavPanel({
  activeAppId,
  menuItems,
  onNavigate,
  onOpenUnlock,
}: {
  activeAppId: MiniAppId | null;
  menuItems: ReadonlyArray<WindowMenuItem>;
  onNavigate: () => void;
  onOpenUnlock: () => void;
}) {
  return (
    <div className="routed-pane-nav-panel">
      <nav aria-label="Apps" className="routed-pane-nav">
        <RoutedPaneHomeNavLink
          activeAppId={activeAppId}
          onNavigate={onNavigate}
        />
        {ROUTED_MINI_APP_NAV_ITEMS.map(({ appId }) => (
          <RoutedPaneNavLink
            key={appId}
            activeAppId={activeAppId}
            appId={appId}
            onNavigate={onNavigate}
          />
        ))}
      </nav>
      <div className="routed-pane-nav-section">
        <PaneSystemMenuItems onClose={onNavigate} onOpenUnlock={onOpenUnlock} />
      </div>
      {menuItems.length > 0 && (
        <div className="routed-pane-nav-section">
          {menuItems.map((item) => (
            <button
              key={item.id}
              className="routed-pane-nav-action"
              disabled={item.disabled}
              type="button"
              onClick={() => {
                item.onClick();
                onNavigate();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The navigation surface in its tier-appropriate container: a persistent
 * `<aside>` rail on tablet, or a slide-in drawer (plus dismiss scrim) on mobile.
 */
export function RoutedPaneNav({
  activeAppId,
  drawerOpen,
  menuItems,
  onCloseDrawer,
  onOpenUnlock,
  tier,
}: {
  activeAppId: MiniAppId | null;
  drawerOpen: boolean;
  menuItems: ReadonlyArray<WindowMenuItem>;
  onCloseDrawer: () => void;
  onOpenUnlock: () => void;
  tier: RoutedLayoutTier;
}) {
  const panel = (
    <RoutedPaneNavPanel
      activeAppId={activeAppId}
      menuItems={menuItems}
      onNavigate={onCloseDrawer}
      onOpenUnlock={onOpenUnlock}
    />
  );

  if (tier === "tablet") {
    return <aside className="routed-pane-rail">{panel}</aside>;
  }

  return (
    <>
      {drawerOpen && (
        <button
          aria-label="Close menu"
          className="routed-pane-scrim"
          type="button"
          onClick={onCloseDrawer}
        />
      )}
      <aside
        aria-hidden={!drawerOpen}
        className="routed-pane-drawer"
        data-open={drawerOpen ? "true" : "false"}
        id="routed-pane-drawer"
      >
        {panel}
      </aside>
    </>
  );
}
