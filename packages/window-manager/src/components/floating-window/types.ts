import type { ReactNode } from 'react';

export interface WindowDimensions {
  width: number;
  height: number;
  x: number;
  y: number;
  isMaximized?: boolean;
  preMaximizeDimensions?: {
    width: number;
    height: number;
    x: number;
    y: number;
  };
}

export interface FloatingWindowProps {
  id: string;
  title: string;
  children: ReactNode;
  onClose: () => void;
  onMinimize?: ((dimensions: WindowDimensions) => void) | undefined;
  onDimensionsChange?: ((dimensions: WindowDimensions) => void) | undefined;
  initialDimensions?: WindowDimensions | undefined;
  fitContent?: boolean | undefined;
  defaultWidth?: number | undefined;
  defaultHeight?: number | undefined;
  defaultX?: number | undefined;
  defaultY?: number | undefined;
  minWidth?: number | undefined;
  minHeight?: number | undefined;
  maxWidthPercent?: number | undefined;
  maxHeightPercent?: number | undefined;
  zIndex?: number | undefined;
  onFocus?: (() => void) | undefined;
  footerHeight?: number | undefined;
}

export interface PreMaximizeState {
  width: number;
  height: number;
  x: number;
  y: number;
}
