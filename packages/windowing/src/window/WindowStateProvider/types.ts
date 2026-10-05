import type { ComponentType } from "react";

export type WindowMoveDirection = "forward" | "backward";

// Window geometry is relative to the desktop surface a window is rendered in
// (the window's offset parent), not to the viewport.
export interface WindowPosition {
  x: number;
  y: number;
}

export interface WindowSize {
  width: number;
  height: number;
}

export interface WindowGeometry {
  position: WindowPosition;
  size?: WindowSize | undefined;
}

export interface WindowEntry {
  // An opaque key naming the app that owns this window. The window layer only
  // stores and compares it; the host interprets it (see Window's
  // ContentBoundary).
  appId?: string;
  id: string;
  initialShowSidebar?: boolean | undefined;
  pathSegments?: ReadonlyArray<string> | undefined;
  // The window's own Back stack: routes previously visited in this window, the
  // most recent last. A window is not backed by browser history (only the
  // routed shell is), so this is what gives the windowed toolbar a working Back
  // caret. Forward is deliberately not modelled — the toolbar offers Back only.
  routeHistory?: ReadonlyArray<ReadonlyArray<string>> | undefined;
  title: string;
  // Where the window first appears, in viewport coordinates (for example the
  // point a launcher was clicked). Ignored once position is known.
  initialX: number;
  initialY: number;
  // The window's committed geometry. Set when the window is first laid out and
  // whenever a drag or resize ends, so a host can save and restore a layout.
  // Without size the window takes its stylesheet's default size.
  position?: WindowPosition | undefined;
  size?: WindowSize | undefined;
  // Whether the window fits itself to its content once the content has loaded
  // (see WindowCreateOptions).
  fitToContent?: boolean | undefined;
  // maximized and minimized live here rather than inside Window so the taskbar
  // can drive both without reaching into a window's local state.
  maximized: boolean;
  minimized: boolean;
  zIndex: number;
  component?: ComponentType;
}

export interface WindowCreateOptions {
  appId?: string;
  // Opens the window fitted to its content, as View > Fit to Content would fit
  // it: once the content has marked itself loaded and reported its natural
  // size. A window maximized by then stays maximized.
  fitToContent?: boolean | undefined;
  initialShowSidebar?: boolean | undefined;
  pathSegments?: ReadonlyArray<string> | undefined;
  // Surface-relative geometry to open with, such as a restored layout. A
  // position takes precedence over create's viewport x/y.
  position?: WindowPosition | undefined;
  size?: WindowSize | undefined;
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
  maximize: (id: string) => void;
  minimize: (id: string) => void;
  restore: (id: string) => void;
  toggleMaximize: (id: string) => void;
  updateRoute: (
    id: string,
    pathSegments: ReadonlyArray<string>,
    options?: { replace?: boolean | undefined },
  ) => void;
  goBackRoute: (id: string) => void;
  updateTitle: (id: string, title: string) => void;
  moveForward: (id: string) => void;
  moveBackward: (id: string) => void;
  bringToFront: (id: string) => void;
  setGeometry: (id: string, geometry: WindowGeometry) => void;
}
