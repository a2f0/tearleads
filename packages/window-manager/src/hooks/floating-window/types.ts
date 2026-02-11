export type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

interface WindowDimensionsSnapshot {
  width: number;
  height: number;
  x: number;
  y: number;
}

export interface UseFloatingWindowOptions {
  defaultWidth: number;
  defaultHeight: number;
  defaultX?: number | undefined;
  defaultY?: number | undefined;
  minWidth: number;
  minHeight: number;
  maxWidthPercent: number;
  maxHeightPercent: number;
  onDimensionsChange?:
    | ((dimensions: WindowDimensionsSnapshot) => void)
    | undefined;
  elementRef?: React.RefObject<HTMLElement | null> | undefined;
}

export interface UseFloatingWindowReturn {
  width: number;
  height: number;
  x: number;
  y: number;
  setDimensions: (width: number, height: number, x: number, y: number) => void;
  createCornerHandlers: (corner: Corner) => {
    onMouseDown: (e: React.MouseEvent) => void;
    onTouchStart: (e: React.TouchEvent) => void;
  };
  createDragHandlers: () => {
    onMouseDown: (e: React.MouseEvent) => void;
    onTouchStart: (e: React.TouchEvent) => void;
  };
}
