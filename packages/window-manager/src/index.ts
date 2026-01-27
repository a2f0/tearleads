// Components
export {
  FloatingWindow,
  type FloatingWindowProps,
  type WindowDimensions
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
export { type Corner, useFloatingWindow } from './hooks/index.js';

// Utilities
export { cn, generateUniqueId } from './lib/index.js';
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
