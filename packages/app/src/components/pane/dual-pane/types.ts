export type PaneSide = "left" | "right";

export interface DualPaneContextValue {
  leftUserId: string | null;
  rightUserId: string | null;
  setLeftUserId: (id: string | null) => void;
  setRightUserId: (id: string | null) => void;
}
