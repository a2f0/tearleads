import type { PropsWithChildren, Ref } from "react";
import { SidebarResizeHandle, useSidebarResize } from "../shared/SidebarResize";
import "./WindowSidebar.css";

const DEFAULT_WIDTH = 160;

export function WindowSidebar({
  contentRef,
  defaultWidth = DEFAULT_WIDTH,
  sidebar,
  children,
}: PropsWithChildren<{
  contentRef?: Ref<HTMLDivElement> | undefined;
  defaultWidth?: number;
  sidebar?: React.ReactNode;
}>) {
  const resize = useSidebarResize({ defaultWidth });

  return (
    <div className="window-sidebar-layout">
      <div
        className="window-sidebar"
        ref={resize.sidebarRef}
        style={{ width: resize.width ?? defaultWidth }}
      >
        {sidebar}
      </div>
      <SidebarResizeHandle
        className="window-sidebar-handle"
        currentWidth={resize.resolvedWidth}
        onKeyDown={resize.handleKeyDown}
        onPointerDown={resize.handlePointerDown}
      />
      {/* Focusable only to script, like `.window-body-content`: the overlay host
          is where focus lands when an overlay outlives the control that opened it. */}
      <div className="window-sidebar-content" ref={contentRef} tabIndex={-1}>
        <div className="window-sidebar-content-scroll">{children}</div>
      </div>
    </div>
  );
}
