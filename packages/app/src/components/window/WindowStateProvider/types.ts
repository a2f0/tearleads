import type { ComponentType } from "react";
import type { MiniAppId } from "../../../mini-apps/types";

export type WindowMoveDirection = "forward" | "backward";

export interface WindowEntry {
  appId?: MiniAppId;
  id: string;
  initialShowSidebar?: boolean | undefined;
  miniAppPathSegments?: ReadonlyArray<string> | undefined;
  title: string;
  initialX: number;
  initialY: number;
  minimized: boolean;
  zIndex: number;
  component?: ComponentType;
}

export interface WindowCreateOptions {
  appId?: MiniAppId;
  initialShowSidebar?: boolean | undefined;
  miniAppPathSegments?: ReadonlyArray<string> | undefined;
}

export interface WindowStateData {
  // windows is the raw useState array — stable and cheap to iterate for
  // rendering lists. windowMap is derived via useMemo for O(1) lookups by ID.
  // Both are already memoized so neither adds redundant computation.
  windows: WindowEntry[];
  windowMap: Map<string, WindowEntry>;
}

export interface WindowStateActions {
  create: (
    title: string,
    x: number,
    y: number,
    component?: ComponentType,
    options?: WindowCreateOptions,
  ) => string;
  close: (id: string) => void;
  minimize: (id: string) => void;
  restore: (id: string) => void;
  updateMiniAppRoute: (id: string, pathSegments: ReadonlyArray<string>) => void;
  updateTitle: (id: string, title: string) => void;
  moveForward: (id: string) => void;
  moveBackward: (id: string) => void;
  bringToFront: (id: string) => void;
}
