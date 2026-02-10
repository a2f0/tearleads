// Components
export {
  FloatingWindow,
  type FloatingWindowProps,
  WindowContextMenu,
  WindowContextMenuItem,
  WindowConnectionIndicator,
  type WindowContextMenuItemProps,
  type WindowConnectionIndicatorProps,
  type WindowContextMenuProps,
  type WindowDimensions,
  WindowStatusBar,
  type WindowStatusBarProps
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
  useFloatingWindow,
  useResizableSidebar
} from './hooks/index.js';

// Utilities
export { cn, generateUniqueId, WINDOW_FIT_CONTENT_EVENT } from './lib/index.js';
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
