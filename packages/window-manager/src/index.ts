// Components
export {
  FloatingWindow,
  type FloatingWindowProps,
  WINDOW_TABLE_TYPOGRAPHY,
  WindowConnectionIndicator,
  type WindowConnectionIndicatorProps,
  WindowContextMenu,
  WindowContextMenuItem,
  type WindowContextMenuItemProps,
  type WindowContextMenuProps,
  type WindowDimensions,
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
  useWindowManager,
  type WindowInstance,
  type WindowManagerContextValue,
  WindowManagerProvider,
  type WindowManagerProviderProps
} from './context/index.js';

// Hooks
export {
  type Corner,
  type UseResizableSidebarResult,
  type UseSidebarDragOverResult,
  useFloatingWindow,
  useResizableSidebar,
  useSidebarDragOver
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
