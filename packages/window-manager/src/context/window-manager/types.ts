import type { ReactNode } from 'react';
import type { WindowDimensions } from '../../components/FloatingWindow.js';

export interface WindowInstance {
  id: string;
  type: string;
  zIndex: number;
  isMinimized: boolean;
  dimensions?: WindowDimensions;
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
  isWindowOpen: (type: string, id?: string) => boolean;
  getWindow: (id: string) => WindowInstance | undefined;
}

export interface WindowManagerProviderProps {
  children: ReactNode;
  loadDimensions?: (type: string) => WindowDimensions | null;
  saveDimensions?: (type: string, dimensions: WindowDimensions) => void;
  shouldPreserveState?: () => boolean;
}
