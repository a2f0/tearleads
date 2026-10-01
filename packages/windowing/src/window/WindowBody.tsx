import type { PropsWithChildren, Ref } from "react";
import "./WindowBody.css";
import { WindowSidebar } from "./WindowSidebar";

interface WindowBodyProps {
  contentRef?: Ref<HTMLDivElement> | undefined;
  showSidebar?: boolean;
  sidebar?: React.ReactNode;
}

// The content pane is programmatically focusable (`tabIndex={-1}`, so never in
// the tab order): an overlay that covered it lands focus here when the control
// that opened the overlay is gone by the time it closes.
export function WindowBody({
  contentRef,
  showSidebar = false,
  sidebar,
  children,
}: PropsWithChildren<WindowBodyProps>) {
  return (
    <div className="window-body">
      {showSidebar ? (
        <WindowSidebar contentRef={contentRef} sidebar={sidebar}>
          {children}
        </WindowSidebar>
      ) : (
        <div className="window-body-content" ref={contentRef} tabIndex={-1}>
          <div className="window-body-content-scroll">{children}</div>
        </div>
      )}
    </div>
  );
}
