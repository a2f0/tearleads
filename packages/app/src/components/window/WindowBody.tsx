import type { PropsWithChildren } from "react";
import "./WindowBody.css";

export function WindowBody({ children }: PropsWithChildren) {
  return <div className="window-body">{children}</div>;
}
