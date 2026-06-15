import { useContext } from "react";

import { PaneSideContext } from "./context";
import type { PaneSide } from "./types";

export function usePaneSide(): PaneSide {
  const side = useContext(PaneSideContext);
  if (!side) {
    throw new Error("usePaneSide must be used within a PaneSideProvider.");
  }
  return side;
}
