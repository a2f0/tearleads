import { ArrowsClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowsClockwise";
import { CaretLeftIcon } from "@phosphor-icons/react/dist/csr/CaretLeft";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { SidebarSimpleIcon } from "@phosphor-icons/react/dist/csr/SidebarSimple";
import { MINI_APPS } from "../../../mini-apps/registry";
import type { MiniAppId } from "../../../mini-apps/types";
import {
  useAppNavigationActions,
  useAppNavigationState,
} from "../../../navigation/AppNavigationProvider";
import type { RoutedLayoutTier } from "../../../navigation/useRoutedLayoutTier";
import { WindowTitleBarActionButtons } from "../../window/WindowChromeActions";
import {
  useWindowBackActionValue,
  useWindowRefreshMenuItemValue,
  useWindowTitleBarActions,
} from "../../window/WindowMenuContext";

export function RoutedPaneAppBar({
  activeAppId,
  hasSidebar,
  onToggleSidebar,
  sidebarExpanded,
  tier,
}: {
  activeAppId: MiniAppId;
  hasSidebar: boolean;
  onToggleSidebar: () => void;
  sidebarExpanded: boolean;
  tier: RoutedLayoutTier;
}) {
  const { goBack, goForward } = useAppNavigationActions();
  const { history } = useAppNavigationState();
  const backAction = useWindowBackActionValue();
  const toolbarActions = useWindowTitleBarActions();
  // The routed shell has no menu bar, so the app's refresh registration — which
  // windowed mode reaches through the View menu — rides the toolbar as a glyph.
  const refreshItem = useWindowRefreshMenuItemValue();
  const backLabel = backAction?.label ?? "Back";
  const canGoBack = backAction ? !backAction.disabled : history.canGoBack;
  const sidebarLabel = sidebarExpanded ? "Hide Sidebar" : "Show Sidebar";
  const showToolbar = toolbarActions.length > 0 || refreshItem !== null;

  return (
    <header className="routed-pane-appbar">
      <div className="routed-pane-appbar-primary">
        <div className="routed-pane-history-controls">
          <button
            aria-label={backLabel}
            className="routed-pane-iconbutton"
            disabled={!canGoBack}
            title={backLabel}
            type="button"
            onClick={backAction?.onClick ?? goBack}
          >
            <CaretLeftIcon aria-hidden size={18} />
          </button>
          <button
            aria-label="Forward"
            className="routed-pane-iconbutton"
            disabled={!history.canGoForward}
            title="Forward"
            type="button"
            onClick={goForward}
          >
            <CaretRightIcon aria-hidden size={18} />
          </button>
        </div>
        {hasSidebar && (
          <button
            aria-controls="routed-pane-sidebar"
            aria-expanded={sidebarExpanded}
            aria-label={sidebarLabel}
            className="routed-pane-iconbutton"
            title={sidebarLabel}
            type="button"
            onClick={onToggleSidebar}
          >
            <SidebarSimpleIcon aria-hidden size={18} />
          </button>
        )}
        {tier !== "mobile" && (
          <div className="routed-pane-title">
            {MINI_APPS[activeAppId].title}
          </div>
        )}
      </div>
      <div className="routed-pane-appbar-spacer" />
      {showToolbar && (
        <div
          aria-label="Toolbar"
          className="routed-pane-toolbar"
          role="toolbar"
        >
          <WindowTitleBarActionButtons
            actions={toolbarActions}
            className="routed-pane-iconbutton"
          />
          {refreshItem && (
            <button
              aria-label={refreshItem.label}
              className="routed-pane-iconbutton"
              disabled={refreshItem.disabled}
              title={refreshItem.label}
              type="button"
              onClick={refreshItem.onClick}
            >
              <ArrowsClockwiseIcon aria-hidden size={18} />
            </button>
          )}
        </div>
      )}
    </header>
  );
}
