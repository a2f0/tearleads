import "./tokens.css";

// The public windowing API: window state, window chrome and its registration
// hooks, the menu and sidebar primitives the chrome renders with, a taskbar's
// start menu, and the icons the chrome draws.
export {
  createRequiredContext,
  type RequiredContext,
} from "./createRequiredContext";
export {
  type WindowingIcons,
  WindowingIconsProvider,
} from "./icons/WindowingIcons";
export type { WindowingIcon, WindowingIconProps } from "./icons/windowingIcon";
export { Menu, type MenuPosition } from "./menu/Menu";
export { MenuItem, type MenuItemProps } from "./menu/MenuItem";
export {
  StartMenu,
  type StartMenuItem,
  type StartMenuProps,
} from "./menu/StartMenu";
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
  useWindowBackground,
  useWindowContentSize,
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
  type WindowCreateOptions,
  type WindowEntry,
  type WindowGeometry,
  type WindowPosition,
  type WindowSize,
  type WindowStateActions,
  type WindowStateData,
  WindowStateProvider,
} from "./window/WindowStateProvider";
export { WindowToolBar } from "./window/WindowToolBar";
