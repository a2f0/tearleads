import type { Icon } from "@phosphor-icons/react";
import { SidebarSimpleIcon } from "@phosphor-icons/react/dist/csr/SidebarSimple";
import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
} from "react";
import { ROUTED_MINI_APP_NAV_ITEMS } from "../../../mini-apps/registry";
import type { MiniAppId } from "../../../mini-apps/types";
import { useVisibleMiniAppItems } from "../../../mini-apps/useVisibleMiniAppItems";
import { useAppNavigationActions } from "../../../navigation/AppNavigationProvider";
import type { RoutedLayoutTier } from "../../../navigation/useRoutedLayoutTier";
import { classNames } from "../../shared/classNames";
import type { LauncherPlacement } from "./LauncherPlacement";
import { RoutedPanePlacementButton } from "./RoutedPanePlacementButton";
import { useMobileSheetDrag } from "./useMobileSheetDrag";
import "./RoutedPaneNav.css";

export const ROUTED_PANE_NAV_PANEL_ID = "routed-pane-nav-panel";

// Let the browser handle modified clicks (Cmd/Ctrl/Shift/Alt + click,
// middle-click) so the href still opens in a new tab/window; only intercept
// a plain left-click for in-app navigation.
function isBrowserHandledNavClick(
  event: ReactMouseEvent<HTMLAnchorElement>,
): boolean {
  return (
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  );
}

function RoutedPaneNavLink({
  appId,
  activeAppId,
  icon: LinkIcon,
  label,
  onNavigate,
}: {
  appId: MiniAppId;
  activeAppId: MiniAppId;
  icon: Icon;
  label: string;
  onNavigate: () => void;
}) {
  const { getMiniAppHref, openMiniApp } = useAppNavigationActions();
  const handleClick = useCallback(
    (event: ReactMouseEvent<HTMLAnchorElement>) => {
      if (isBrowserHandledNavClick(event)) {
        return;
      }
      event.preventDefault();
      openMiniApp({ appId });
      onNavigate();
    },
    [appId, onNavigate, openMiniApp],
  );

  return (
    <a
      aria-current={activeAppId === appId ? "page" : undefined}
      className={classNames(
        "routed-pane-nav-link",
        activeAppId === appId && "routed-pane-nav-link--active",
      )}
      href={getMiniAppHref(appId)}
      onClick={handleClick}
    >
      <LinkIcon aria-hidden="true" size={20} />
      <span className="routed-pane-nav-link-label">{label}</span>
    </a>
  );
}

/**
 * The tablet rail's navigation surface: an icon-and-label link per routed
 * mini-app. System commands and per-app file/view actions belong to the app bar
 * toolbar at the top of the shell.
 */
function RoutedPaneNavPanel({
  activeAppId,
  id,
  onNavigate,
}: {
  activeAppId: MiniAppId;
  id: string;
  onNavigate: () => void;
}) {
  const visibleNavItems = useVisibleMiniAppItems(ROUTED_MINI_APP_NAV_ITEMS);
  return (
    <nav aria-label="Apps" className="routed-pane-nav-panel" id={id}>
      {visibleNavItems.map(({ appId, icon, label }) => (
        <RoutedPaneNavLink
          key={appId}
          activeAppId={activeAppId}
          appId={appId}
          icon={icon}
          label={label}
          onNavigate={onNavigate}
        />
      ))}
    </nav>
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
      className="routed-pane-iconbutton routed-pane-rail-toggle"
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
        if (isBrowserHandledNavClick(event)) {
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
 * The bottom-sheet navigation: every routed mini-app as a grid of square
 * icon-and-label tiles (styled after Explorer's New Document screen). Like the
 * tablet rail it carries no per-app contextual actions. Selecting a tile
 * navigates and dismisses.
 */
function RoutedPaneMobileNav({
  activeAppId,
  onNavigate,
}: {
  activeAppId: MiniAppId;
  onNavigate: () => void;
}) {
  const { getMiniAppHref, openMiniApp } = useAppNavigationActions();
  const visibleNavItems = useVisibleMiniAppItems(ROUTED_MINI_APP_NAV_ITEMS);

  return (
    <nav aria-label="Apps" className="routed-pane-sheet-grid">
      {visibleNavItems.map(({ appId, icon, label }) => (
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

function RoutedPaneMobileSheetHandle({
  dragging,
  onClick,
  onPointerDown,
}: {
  dragging: boolean;
  onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      aria-label="Dismiss menu"
      className="routed-pane-sheet-handle"
      data-dragging={dragging ? "true" : "false"}
      type="button"
      onClick={onClick}
      onPointerDown={onPointerDown}
    >
      <span aria-hidden="true" />
    </button>
  );
}

/**
 * The navigation surface in its tier-appropriate container: a persistent
 * `<aside>` rail in tablet side mode, or a bottom sheet of launcher tiles (plus
 * dismiss scrim) on mobile and in tablet bottom mode.
 */
export function RoutedPaneNav({
  activeAppId,
  drawerOpen,
  launcherPlacement,
  onCloseDrawer,
  onNavigateRail,
  onToggleLauncherPlacement,
  onToggleRail,
  railExpanded,
  tier,
}: {
  activeAppId: MiniAppId;
  drawerOpen: boolean;
  launcherPlacement: LauncherPlacement;
  onCloseDrawer: () => void;
  onNavigateRail: () => void;
  onToggleLauncherPlacement: () => void;
  onToggleRail: () => void;
  railExpanded: boolean;
  tier: RoutedLayoutTier;
}) {
  const sheetRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (drawerOpen && (tier === "mobile" || launcherPlacement === "bottom")) {
      const sheet = sheetRef.current;
      const tile = sheet?.querySelector<HTMLElement>(
        '.routed-pane-sheet-tile[aria-current="page"]',
      );
      (
        tile ?? sheet?.querySelector<HTMLElement>(".routed-pane-sheet-tile")
      )?.focus();
    }
  }, [drawerOpen, launcherPlacement, tier]);

  const mobileSheetDrag = useMobileSheetDrag({
    drawerOpen:
      (tier === "mobile" || launcherPlacement === "bottom") && drawerOpen,
    onClose: onCloseDrawer,
  });

  if (tier === "tablet" && launcherPlacement === "side") {
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
            onNavigate={onNavigateRail}
          />
        )}
        <RoutedPanePlacementButton
          launcherPlacement={launcherPlacement}
          onToggle={onToggleLauncherPlacement}
        />
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
        ref={sheetRef}
        data-dragging={mobileSheetDrag.dragging ? "true" : "false"}
        data-open={drawerOpen ? "true" : "false"}
        id="routed-pane-sheet"
        style={
          drawerOpen && mobileSheetDrag.dragOffset > 0
            ? { transform: `translateY(${mobileSheetDrag.dragOffset}px)` }
            : undefined
        }
      >
        <div className="routed-pane-sheet-header">
          <RoutedPaneMobileSheetHandle
            dragging={mobileSheetDrag.dragging}
            onClick={mobileSheetDrag.handleClick}
            onPointerDown={mobileSheetDrag.handlePointerDown}
          />
          {tier === "tablet" && (
            <RoutedPanePlacementButton
              launcherPlacement={launcherPlacement}
              onToggle={onToggleLauncherPlacement}
            />
          )}
        </div>
        <RoutedPaneMobileNav
          activeAppId={activeAppId}
          onNavigate={onCloseDrawer}
        />
      </aside>
    </>
  );
}
