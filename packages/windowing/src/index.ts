// The public windowing API: window state, window chrome and its registration
// hooks, and the menu and sidebar primitives the chrome renders with.
export { Menu, type MenuPosition } from "./menu/Menu";
export { MenuItem, type MenuItemProps } from "./menu/MenuItem";
export {
  type ContextMenuState,
  useContextMenuPositionState,
  useContextMenuState,
} from "./menu/useContextMenuState";
export { SidebarResizeHandle, useSidebarResize } from "./sidebar/SidebarResize";
export {
  CurrentWindowProvider,
  useCurrentWindow,
  useSuppressWindowToolbar,
} from "./window/CurrentWindowContext";
export { Window, type WindowContentBoundary } from "./window/Window";
export { WindowTitleBarActionButtons } from "./window/WindowChromeActions";
export { WindowCloseButton } from "./window/WindowCloseButton";
export {
  useWindowBackAction,
  useWindowBackActionValue,
  useWindowFileMenuItem,
  useWindowRefreshMenuItem,
  useWindowRefreshMenuItemValue,
  useWindowTitleBarAction,
  useWindowTitleBarActions,
  useWindowToolbarReservation,
  useWindowViewMenuItem,
  WindowMenuProvider,
} from "./window/WindowMenuContext";
export {
  hasWindowSidebar,
  useRegisteredWindowSidebar,
  useWindowSidebar,
  WindowSidebarProvider,
} from "./window/WindowSidebarContext";
export {
  findTopWindow,
  useWindowActions,
  useWindowStateData,
  type WindowEntry,
  type WindowStateActions,
  type WindowStateData,
  WindowStateProvider,
} from "./window/WindowStateProvider";
export { WindowToolBar } from "./window/WindowToolBar";
