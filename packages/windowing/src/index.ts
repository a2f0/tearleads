import "./tokens.css";

// The public windowing API: window state, window chrome and its registration
// hooks, the menu and sidebar primitives the chrome renders with, a taskbar's
// start menu and theme switch, the icons the chrome draws, a launcher of
// mini-apps that shows them in windows or in the routed (iPad / phone) shell,
// and desktop icons that open them, with a storage adapter for their layout,
// over a wallpaper chosen in Display Properties.
export {
  createRequiredContext,
  type RequiredContext,
} from "./createRequiredContext";
export type { DesktopIconMenuItem } from "./desktop/DesktopIconMenu";
export {
  DesktopIcons,
  type DesktopIconsProps,
} from "./desktop/DesktopIcons";
export type {
  DesktopIconPosition,
  DesktopState,
} from "./desktop/desktopState";
export {
  createMemoryDesktopStateStorage,
  createOpfsDesktopStateStorage,
  type DesktopStateStorage,
  type OpfsDesktopStateStorageOptions,
} from "./desktop/desktopStateStorage";
export { DisplayProperties } from "./display/DisplayProperties";
export {
  type WindowingIcons,
  WindowingIconsProvider,
} from "./icons/WindowingIcons";
export type { WindowingIcon, WindowingIconProps } from "./icons/windowingIcon";
export {
  ROUTED_TABLET_BREAKPOINT_PX,
  ROUTED_TABLET_QUERY,
  WINDOWED_LAYOUT_MIN_WIDTH_PX,
} from "./launcher/breakpoints";
export {
  DEFAULT_MINI_APP_POSITION,
  type LauncherNavigationActions,
  LauncherNavigationProvider,
  type LauncherNavigationState,
  type OpenMiniAppRequest,
  useLauncherNavigationActions,
  useLauncherNavigationState,
  useMiniAppRouteSegments,
  useOptionalLauncherNavigationState,
} from "./launcher/LauncherNavigationProvider";
export {
  isLauncherAppId,
  type LauncherDefinition,
  type MiniAppDefinition,
  resolveLauncherHomeAppId,
  resolveLauncherOrder,
} from "./launcher/launcherDefinition";
export {
  MiniAppRouteSegmentsProvider,
  useMiniAppWindowRouteSegments,
} from "./launcher/MiniAppRouteSegmentsContext";
export { type MiniAppBoundary, MiniAppWindow } from "./launcher/MiniAppWindow";
export {
  NavigationModeOverrideProvider,
  useNavigationModeOverride,
  useOptionalNavigationModeOverride,
} from "./launcher/NavigationModeOverrideProvider";
export { NavigationModeSwitch } from "./launcher/NavigationModeSwitch";
export {
  isWindowedLayoutEligible,
  type NavigationEnvironment,
  type NavigationMode,
  readNavigationEnvironment,
  resolveNavigationMode,
} from "./launcher/navigationMode";
export {
  buildMiniAppPath,
  type LauncherRoute,
  parseLauncherRoute,
} from "./launcher/routePaths";
export {
  resolveActiveLauncherRoute,
  useActiveLauncherRoute,
} from "./launcher/useActiveLauncherRoute";
export { useCompactRoutedMode } from "./launcher/useCompactRoutedMode";
export {
  type MiniAppRouteSetOptions,
  useMiniAppRouteState,
} from "./launcher/useMiniAppRouteState";
export { useNavigationMode } from "./launcher/useNavigationMode";
export { useNavigationModeDocumentAttribute } from "./launcher/useNavigationModeDocumentAttribute";
export {
  useRoutedLayoutActive,
  useWindowedLayoutActive,
} from "./launcher/useRoutedLayoutActive";
export {
  type RoutedLayoutTier,
  useRoutedLayoutTier,
} from "./launcher/useRoutedLayoutTier";
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
export { RoutedPane, type RoutedPaneProps } from "./routed/RoutedPane";
export {
  RoutedPaneOverlayHostProvider,
  type RoutedPaneOverlayHostValue,
  useRoutedPaneOverlayHost,
} from "./routed/RoutedPaneOverlayHost";
export type { SubscribeKeyboardVisibility } from "./routed/useMobileKeyboardVisible";
export { SidebarResizeHandle, useSidebarResize } from "./sidebar/SidebarResize";
export {
  ThemeProvider,
  useOptionalTheme,
  useTheme,
} from "./theme/ThemeProvider";
export { ThemeSwitch } from "./theme/ThemeSwitch";
export type {
  DefaultTheme,
  ThemeDefinition,
  ThemeScheme,
} from "./theme/themes";
export {
  DesktopWallpaper,
  type DesktopWallpaperProps,
} from "./wallpaper/DesktopWallpaper";
export {
  BLOCKS_WALLPAPER,
  CHEVRON_WALLPAPER,
  HARLEQUIN_WALLPAPER,
  HONEYCOMB_WALLPAPER,
  PLAIN_WALLPAPER,
  TRIANGLES_WALLPAPER,
} from "./wallpaper/tessellations";
export {
  useOptionalWallpaper,
  useWallpaper,
  WallpaperProvider,
} from "./wallpaper/WallpaperProvider";
export type {
  WallpaperDefinition,
  WallpaperTile,
} from "./wallpaper/wallpapers";
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
