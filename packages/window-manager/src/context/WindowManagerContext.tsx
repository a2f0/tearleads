export type {
  WindowInstance,
  WindowManagerContextValue,
  WindowManagerProviderProps
} from './window-manager/types.js';
export {
  getDefaultDesktopWindowDimensions,
  type DefaultDesktopWindowDimensionsOptions
} from './window-manager/defaultDesktopWindowDimensions.js';
export { useWindowManager } from './window-manager/useWindowManager.js';
export { WindowManagerProvider } from './window-manager/WindowManagerProvider.js';
