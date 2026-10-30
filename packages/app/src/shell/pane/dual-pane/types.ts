import type { Dispatch, SetStateAction } from "react";

export type PaneSide = "left" | "right";

export interface DualPaneContextValue {
  /** Each pane's own identity link: the only way the other pane admits it. */
  leftIdentityLink: string | null;
  leftUserId: string | null;
  peerUserIdsEnabled: boolean;
  rightIdentityLink: string | null;
  rightUserId: string | null;
  setLeftIdentityLink: Dispatch<SetStateAction<string | null>>;
  setLeftUserId: Dispatch<SetStateAction<string | null>>;
  setRightIdentityLink: Dispatch<SetStateAction<string | null>>;
  setRightUserId: Dispatch<SetStateAction<string | null>>;
}
