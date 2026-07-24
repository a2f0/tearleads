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
import {
  useWindowBackActionValue,
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
  const backLabel = backAction?.label ?? "Back";
  const canGoBack = backAction ? !backAction.disabled : history.canGoBack;
  const sidebarLabel = sidebarExpanded ? "Hide Sidebar" : "Show Sidebar";
  const showToolbar = toolbarActions.length > 0;

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
          {toolbarActions.map((action) => (
            <button
              aria-label={action.label}
              className="routed-pane-iconbutton"
              disabled={action.disabled}
              key={action.id}
              title={action.label}
              type="button"
              onClick={action.onClick}
            >
              {action.icon}
            </button>
          ))}
        </div>
      )}
    </header>
  );
}
