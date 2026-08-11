import type { PropsWithChildren } from "react";

import { paneSideContext } from "./context";
import type { PaneSide } from "./types";

export function PaneSideProvider({
  side,
  children,
}: PropsWithChildren<{ side: PaneSide }>) {
  return (
    <paneSideContext.context.Provider value={side}>
      {children}
    </paneSideContext.context.Provider>
  );
}
