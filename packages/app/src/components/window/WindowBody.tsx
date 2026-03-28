import type { PropsWithChildren } from "react";
import "./WindowBody.css";
import { WindowSidebar } from "./WindowSidebar";

interface WindowBodyProps {
  sidebar?: React.ReactNode;
  showSidebar?: boolean;
}

export function WindowBody({
  sidebar,
  showSidebar = false,
  children,
}: PropsWithChildren<WindowBodyProps>) {
  return (
    <div className="window-body">
      {showSidebar ? (
        <WindowSidebar sidebar={sidebar}>{children}</WindowSidebar>
      ) : (
        children
      )}
    </div>
  );
}
