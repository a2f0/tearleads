import type { PropsWithChildren } from "react";

import { PaneSideContext } from "./context";
import type { PaneSide } from "./types";

export function PaneSideProvider({
  side,
  children,
}: PropsWithChildren<{ side: PaneSide }>) {
  return (
    <PaneSideContext.Provider value={side}>{children}</PaneSideContext.Provider>
  );
}
