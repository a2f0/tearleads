import type { Icon } from "@phosphor-icons/react";
import { HouseIcon } from "@phosphor-icons/react/dist/csr/House";
import { SidebarSimpleIcon } from "@phosphor-icons/react/dist/csr/SidebarSimple";
import { type MouseEvent as ReactMouseEvent, useCallback } from "react";
import {
  MINI_APPS,
  ROUTED_MINI_APP_NAV_ITEMS,
} from "../../../mini-apps/registry";
import type { MiniAppId } from "../../../mini-apps/types";
import { useAppNavigationActions } from "../../../navigation/AppNavigationProvider";
import type { RoutedLayoutTier } from "../../../navigation/useRoutedLayoutTier";
import { classNames } from "../../shared/classNames";
import { PaneSystemMenuItems } from "../../shared/PaneSystemMenuItems";
import type { WindowMenuItem } from "../../window/WindowMenuBar";

const ROUTED_PANE_NAV_PANEL_ID = "routed-pane-nav-panel";

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
  id,
  menuItems,
  onNavigate,
  onOpenUnlock,
  onRequestDestroyKeyPackage,
  onRequestLogout,
  showDeveloperControls,
}: {
  activeAppId: MiniAppId | null;
  id?: string | undefined;
  menuItems: ReadonlyArray<WindowMenuItem>;
  onNavigate: () => void;
  onOpenUnlock: () => void;
  onRequestDestroyKeyPackage: () => void;
  onRequestLogout: () => void;
  showDeveloperControls: boolean;
}) {
  return (
    <div className="routed-pane-nav-panel" id={id}>
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
        <PaneSystemMenuItems
          onClose={onNavigate}
          onOpenUnlock={onOpenUnlock}
          onRequestDestroyKeyPackage={onRequestDestroyKeyPackage}
          onRequestLogout={onRequestLogout}
          showDeveloperControls={showDeveloperControls}
          showLogout={false}
        />
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

function RoutedPaneRailToggle({
  expanded,
  onToggle,
}: {
  expanded: boolean;
  onToggle: () => void;
}) {
  const label = expanded
    ? "Collapse navigation rail"
    : "Expand navigation rail";

  return (
    <button
      aria-controls={expanded ? ROUTED_PANE_NAV_PANEL_ID : undefined}
      aria-expanded={expanded}
      aria-label={label}
      className="routed-pane-rail-toggle"
      title={label}
      type="button"
      onClick={onToggle}
    >
      <SidebarSimpleIcon aria-hidden="true" size={18} />
    </button>
  );
}

function RoutedPaneMobileNavTile({
  active,
  href,
  icon: TileIcon,
  label,
  onSelect,
}: {
  active: boolean;
  href: string;
  icon: Icon;
  label: string;
  onSelect: () => void;
}) {
  return (
    <a
      aria-current={active ? "page" : undefined}
      className={classNames(
        "routed-pane-sheet-tile",
        active && "routed-pane-sheet-tile--active",
      )}
      href={href}
      onClick={(event) => {
        // Let the browser handle modified clicks (Cmd/Ctrl/Shift/Alt + click,
        // middle-click) so the href still opens in a new tab/window; only
        // intercept a plain left-click for in-app navigation.
        if (
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }
        event.preventDefault();
        onSelect();
      }}
    >
      <TileIcon aria-hidden="true" size={32} />
      <span className="routed-pane-sheet-tile-label">{label}</span>
    </a>
  );
}

/**
 * The mobile bottom-sheet navigation: Home plus every routed mini-app as a grid
 * of square icon-and-label tiles (styled after Explorer's New Document screen).
 * Unlike the tablet rail it carries no system or per-app contextual actions —
 * the sheet is a pure launcher. Selecting a tile navigates and dismisses.
 */
function RoutedPaneMobileNav({
  activeAppId,
  onNavigate,
}: {
  activeAppId: MiniAppId | null;
  onNavigate: () => void;
}) {
  const { getHomeHref, getMiniAppHref, navigateHome, openMiniApp } =
    useAppNavigationActions();

  return (
    <nav aria-label="Apps" className="routed-pane-sheet-grid">
      <RoutedPaneMobileNavTile
        active={activeAppId === null}
        href={getHomeHref()}
        icon={HouseIcon}
        label="Home"
        onSelect={() => {
          navigateHome();
          onNavigate();
        }}
      />
      {ROUTED_MINI_APP_NAV_ITEMS.map(({ appId, icon, label }) => (
        <RoutedPaneMobileNavTile
          key={appId}
          active={activeAppId === appId}
          href={getMiniAppHref(appId)}
          icon={icon}
          label={label}
          onSelect={() => {
            openMiniApp({ appId });
            onNavigate();
          }}
        />
      ))}
    </nav>
  );
}

/**
 * The navigation surface in its tier-appropriate container: a persistent
 * `<aside>` rail on tablet, or a bottom sheet of launcher tiles (plus dismiss
 * scrim) on mobile.
 */
export function RoutedPaneNav({
  activeAppId,
  drawerOpen,
  menuItems,
  onCloseDrawer,
  onOpenUnlock,
  onRequestDestroyKeyPackage,
  onRequestLogout,
  onToggleRail,
  railExpanded,
  showDeveloperControls,
  tier,
}: {
  activeAppId: MiniAppId | null;
  drawerOpen: boolean;
  menuItems: ReadonlyArray<WindowMenuItem>;
  onCloseDrawer: () => void;
  onOpenUnlock: () => void;
  onRequestDestroyKeyPackage: () => void;
  onRequestLogout: () => void;
  onToggleRail: () => void;
  railExpanded: boolean;
  showDeveloperControls: boolean;
  tier: RoutedLayoutTier;
}) {
  if (tier === "tablet") {
    return (
      <aside
        className={classNames(
          "routed-pane-rail",
          !railExpanded && "routed-pane-rail--collapsed",
        )}
        data-state={railExpanded ? "open" : "closed"}
      >
        <RoutedPaneRailToggle expanded={railExpanded} onToggle={onToggleRail} />
        {railExpanded && (
          <RoutedPaneNavPanel
            activeAppId={activeAppId}
            id={ROUTED_PANE_NAV_PANEL_ID}
            menuItems={menuItems}
            onNavigate={onCloseDrawer}
            onOpenUnlock={onOpenUnlock}
            onRequestDestroyKeyPackage={onRequestDestroyKeyPackage}
            onRequestLogout={onRequestLogout}
            showDeveloperControls={showDeveloperControls}
          />
        )}
      </aside>
    );
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
        className="routed-pane-sheet"
        data-open={drawerOpen ? "true" : "false"}
        id="routed-pane-sheet"
      >
        <RoutedPaneMobileNav
          activeAppId={activeAppId}
          onNavigate={onCloseDrawer}
        />
      </aside>
    </>
  );
}
