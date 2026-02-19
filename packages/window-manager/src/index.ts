// Components
export {
  DESKTOP_CONTEXT_MENU_OVERLAY_Z_INDEX,
  DESKTOP_CONTEXT_MENU_Z_INDEX,
  DESKTOP_WINDOW_FOOTER_HEIGHT,
  DesktopBackground,
  type DesktopBackgroundPattern,
  type DesktopBackgroundProps,
  DesktopContextMenu,
  DesktopContextMenuItem,
  type DesktopContextMenuItemProps,
  type DesktopContextMenuProps,
  DesktopContextMenuSeparator,
  DesktopFloatingWindow,
  type DesktopFloatingWindowProps,
  DesktopStartBar,
  type DesktopStartBarProps,
  DesktopStartButton,
  type DesktopStartButtonProps,
  DesktopSystemTray,
  type DesktopSystemTrayProps,
  DesktopTaskbar,
  DesktopTaskbarButton,
  type DesktopTaskbarButtonProps,
  type DesktopTaskbarProps,
  type DesktopTaskbarWindow,
  FloatingWindow,
  type FloatingWindowProps,
  WINDOW_TABLE_TYPOGRAPHY,
  WindowConnectionIndicator,
  type WindowConnectionIndicatorProps,
  WindowContextMenu,
  WindowContextMenuItem,
  type WindowContextMenuItemProps,
  type WindowContextMenuProps,
  WindowControlBar,
  type WindowControlBarProps,
  WindowControlButton,
  type WindowControlButtonProps,
  WindowControlDivider,
  type WindowControlDividerProps,
  WindowControlGroup,
  type WindowControlGroupProps,
  type WindowDimensions,
  WindowMenuBar,
  type WindowMenuBarProps,
  WindowPaneState,
  type WindowPaneStateProps,
  WindowSidebarError,
  type WindowSidebarErrorProps,
  WindowSidebarHeader,
  type WindowSidebarHeaderProps,
  WindowSidebarItem,
  type WindowSidebarItemProps,
  WindowSidebarLoading,
  WindowStatusBar,
  type WindowStatusBarProps,
  WindowTableRow,
  type WindowTableRowProps
} from './components/index.js';

// Context
export {
  type DefaultDesktopWindowDimensionsOptions,
  getDefaultDesktopWindowDimensions,
  useWindowManager,
  type WindowInstance,
  type WindowManagerContextValue,
  WindowManagerProvider,
  type WindowManagerProviderProps
} from './context/index.js';

// Hooks
export {
  type Corner,
  type UseCombinedRefreshResult,
  type UseResizableSidebarResult,
  type UseSidebarDragOverResult,
  type UseWindowRefreshResult,
  useCombinedRefresh,
  useFloatingWindow,
  useResizableSidebar,
  useSidebarDragOver,
  useSidebarRefetch,
  useWindowRefresh
} from './hooks/index.js';

// Utilities
export {
  cn,
  detectPlatform,
  generateUniqueId,
  type WindowPlatform
} from './lib/index.js';
// Storage utilities
export {
  clearAllWindowDimensions,
  clearPreserveWindowState,
  clearWindowDimensions,
  getPreserveWindowState,
  loadWindowDimensions,
  type StoredWindowDimensions,
  saveWindowDimensions,
  setPreserveWindowState,
  subscribePreserveWindowState
} from './storage/index.js';
