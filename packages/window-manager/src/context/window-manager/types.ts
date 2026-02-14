import type { ReactNode } from 'react';
import type { WindowDimensions } from '../../components/FloatingWindow.js';

export interface WindowInstance {
  id: string;
  type: string;
  zIndex: number;
  isMinimized: boolean;
  dimensions?: WindowDimensions;
  title?: string | undefined;
}

export interface ResolveInitialWindowDimensionsOptions {
  type: string;
  savedDimensions: WindowDimensions | null;
  currentWindows: WindowInstance[];
}

export interface WindowManagerContextValue {
  windows: WindowInstance[];
  openWindow: (type: string, id?: string) => string;
  closeWindow: (id: string) => void;
  focusWindow: (id: string) => void;
  minimizeWindow: (id: string, dimensions?: WindowDimensions) => void;
  restoreWindow: (id: string) => void;
  updateWindowDimensions: (id: string, dimensions: WindowDimensions) => void;
  saveWindowDimensionsForType: (
    type: string,
    dimensions: WindowDimensions
  ) => void;
  renameWindow: (id: string, title: string) => void;
  isWindowOpen: (type: string, id?: string) => boolean;
  getWindow: (id: string) => WindowInstance | undefined;
}

export interface WindowManagerProviderProps {
  children: ReactNode;
  loadDimensions?: (type: string) => WindowDimensions | null;
  saveDimensions?: (type: string, dimensions: WindowDimensions) => void;
  shouldPreserveState?: () => boolean;
  createWindowId?: ((type: string) => string) | undefined;
  resolveInitialDimensions?:
    | ((options: ResolveInitialWindowDimensionsOptions) => WindowDimensions | undefined)
    | undefined;
}
