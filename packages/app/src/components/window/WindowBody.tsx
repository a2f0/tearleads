import type { PropsWithChildren, Ref } from "react";
import "./WindowBody.css";
import { WindowSidebar } from "./WindowSidebar";

interface WindowBodyProps {
  contentRef?: Ref<HTMLDivElement>;
  showSidebar?: boolean;
  sidebar?: React.ReactNode;
}

export function WindowBody({
  contentRef,
  showSidebar = false,
  sidebar,
  children,
}: PropsWithChildren<WindowBodyProps>) {
  return (
    <div className="window-body">
      {showSidebar ? (
        <WindowSidebar
          {...(contentRef ? { contentRef } : {})}
          sidebar={sidebar}
        >
          {children}
        </WindowSidebar>
      ) : (
        <div className="window-body-content" ref={contentRef}>
          <div className="window-body-content-scroll">{children}</div>
        </div>
      )}
    </div>
  );
}
