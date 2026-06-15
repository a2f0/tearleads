import type { Dispatch, SetStateAction } from "react";

export type PaneSide = "left" | "right";

export interface DualPaneContextValue {
  leftUserId: string | null;
  rightUserId: string | null;
  setLeftUserId: Dispatch<SetStateAction<string | null>>;
  setRightUserId: Dispatch<SetStateAction<string | null>>;
}
