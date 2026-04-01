import type { PropsWithChildren } from "react";
import "./WindowBody.css";
import { WindowSidebar } from "./WindowSidebar";

interface WindowBodyProps {
  showSidebar?: boolean;
  sidebar?: React.ReactNode;
}

export function WindowBody({
  showSidebar = false,
  sidebar,
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
