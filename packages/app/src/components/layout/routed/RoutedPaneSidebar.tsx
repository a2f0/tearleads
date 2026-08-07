import type { ReactNode } from "react";
import type { RoutedLayoutTier } from "../../../navigation/useRoutedLayoutTier";
import {
  SidebarResizeHandle,
  useSidebarResize,
} from "../../shared/SidebarResize";
import "./RoutedPaneSidebar.css";

const DEFAULT_WIDTH = 224;

function RoutedPaneMobileSidebar({
  children,
  onClose,
}: {
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <>
      <button
        aria-label="Close sidebar"
        className="routed-pane-scrim"
        type="button"
        onClick={onClose}
      />
      <div
        className="routed-pane-sidebar"
        id="routed-pane-sidebar"
        role="dialog"
      >
        {children}
      </div>
    </>
  );
}

function RoutedPaneTabletSidebar({ children }: { children: ReactNode }) {
  const resize = useSidebarResize({
    defaultWidth: DEFAULT_WIDTH,
    initialWidth: null,
  });

  return (
    <div className="routed-pane-sidebar-frame">
      <div
        className="routed-pane-sidebar"
        id="routed-pane-sidebar"
        ref={resize.sidebarRef}
        style={resize.width === null ? undefined : { width: resize.width }}
      >
        {children}
      </div>
      <SidebarResizeHandle
        className="routed-pane-sidebar-resize-handle"
        controls="routed-pane-sidebar"
        currentWidth={resize.resolvedWidth}
        onKeyDown={resize.handleKeyDown}
        onPointerDown={resize.handlePointerDown}
      />
    </div>
  );
}

export function RoutedPaneSidebar({
  children,
  onClose,
  tier,
}: {
  children: ReactNode;
  onClose: () => void;
  tier: RoutedLayoutTier;
}) {
  return tier === "mobile" ? (
    <RoutedPaneMobileSidebar onClose={onClose}>
      {children}
    </RoutedPaneMobileSidebar>
  ) : (
    <RoutedPaneTabletSidebar>{children}</RoutedPaneTabletSidebar>
  );
}
