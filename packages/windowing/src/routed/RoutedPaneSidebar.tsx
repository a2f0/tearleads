import type { ReactNode } from "react";
import type { RoutedLayoutTier } from "../launcher/useRoutedLayoutTier";
import {
  SidebarResizeHandle,
  useSidebarResize,
} from "../sidebar/SidebarResize";
import "./RoutedPaneSidebar.css";

const DEFAULT_WIDTH = 224;

function getResizeContainer(sidebar: HTMLElement) {
  // The app bar spans sidebar + content in both launcher placements. Its width
  // also changes when the side launcher expands, even if the viewport does not.
  return (
    sidebar
      .closest(".routed-pane")
      ?.querySelector<HTMLElement>(".routed-pane-appbar") ?? null
  );
}

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
    getResizeContainer,
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
        maxWidth={resize.maxWidth}
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
