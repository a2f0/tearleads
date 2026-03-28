import type { PropsWithChildren } from "react";
import "./WindowBody.css";
import { WindowSidebar } from "./WindowSidebar";

interface WindowBodyProps {
  showSidebar?: boolean;
}

export function WindowBody({
  showSidebar = false,
  children,
}: PropsWithChildren<WindowBodyProps>) {
  return (
    <div className="window-body">
      {showSidebar ? (
        <WindowSidebar>{children}</WindowSidebar>
      ) : (
        children
      )}
    </div>
  );
}
