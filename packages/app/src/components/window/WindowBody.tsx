import type { PropsWithChildren } from "react";

export function WindowBody({ children }: PropsWithChildren) {
  return <div className="window-body">{children}</div>;
}
