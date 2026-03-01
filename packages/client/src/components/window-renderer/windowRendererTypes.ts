import type { WindowDimensions } from '@tearleads/window-manager';
import type { ComponentType } from 'react';
import type {
  WindowInstance,
  WindowType
} from '@/contexts/WindowManagerContext';

export interface WindowComponentProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: (dimensions: WindowDimensions) => void;
  onRename?: (title: string) => void;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions;
}

export interface WindowComponentConfig {
  Component: ComponentType<WindowComponentProps>;
  getInitialDimensions?: (
    window: WindowInstance
  ) => WindowDimensions | undefined;
}

export interface MemoizedWindowProps {
  window: WindowInstance;
  config: WindowComponentConfig;
  onClose: (id: string) => void;
  onMinimize: (id: string, dimensions: WindowDimensions) => void;
  onDimensionsChange: (
    type: WindowType,
    id: string,
    dimensions: WindowDimensions
  ) => void;
  onRename: (id: string, title: string) => void;
  onFocus: (id: string) => void;
}
