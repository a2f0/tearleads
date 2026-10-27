import { CaretLeftIcon } from "@phosphor-icons/react/dist/csr/CaretLeft";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { SidebarSimpleIcon } from "@phosphor-icons/react/dist/csr/SidebarSimple";
import {
  useLauncherNavigationActions,
  useLauncherNavigationState,
} from "../launcher/LauncherNavigationProvider";
import type { RoutedLayoutTier } from "../launcher/useRoutedLayoutTier";
import { WindowTitleBarActionButtons } from "../window/WindowChromeActions";
import {
  useWindowBackActionValue,
  useWindowRefreshMenuItemValue,
  useWindowTitleBarActions,
} from "../window/WindowMenuContext";
import { WindowRefreshButton } from "../window/WindowRefreshButton";

export function RoutedPaneAppBar({
  activeAppId,
  hasSidebar,
  onToggleSidebar,
  sidebarExpanded,
  tier,
}: {
  activeAppId: string;
  hasSidebar: boolean;
  onToggleSidebar: () => void;
  sidebarExpanded: boolean;
  tier: RoutedLayoutTier;
}) {
  const { goBack, goForward } = useLauncherNavigationActions();
  const { definition, history } = useLauncherNavigationState();
  const backAction = useWindowBackActionValue();
  const toolbarActions = useWindowTitleBarActions();
  // Both hosts draw the same registered refresh action beside app actions.
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
            {definition.apps[activeAppId]?.title}
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
            <WindowRefreshButton
              className="routed-pane-iconbutton"
              item={refreshItem}
            />
          )}
        </div>
      )}
    </header>
  );
}
