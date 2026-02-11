import type { Corner } from './types.js';

interface Size {
  width: number;
  height: number;
}

interface Position {
  x: number;
  y: number;
}

interface Bounds {
  maxWidth: number;
  maxHeight: number;
}

interface MinSize {
  minWidth: number;
  minHeight: number;
}

interface ResizeStart extends Size, Position {}

interface ResizeDelta {
  deltaX: number;
  deltaY: number;
}

export function constrainPosition(
  position: Position,
  size: Size,
  viewport: Size
): Position {
  return {
    x: Math.max(0, Math.min(position.x, viewport.width - size.width)),
    y: Math.max(0, Math.min(position.y, viewport.height - size.height))
  };
}

export function calculateResizeForCorner(
  corner: Corner,
  start: ResizeStart,
  delta: ResizeDelta,
  min: MinSize,
  bounds: Bounds
): ResizeStart {
  switch (corner) {
    case 'top-left': {
      const width = Math.min(
        bounds.maxWidth,
        Math.max(min.minWidth, start.width - delta.deltaX)
      );
      const height = Math.min(
        bounds.maxHeight,
        Math.max(min.minHeight, start.height - delta.deltaY)
      );
      return {
        width,
        height,
        x: start.x - (width - start.width),
        y: start.y - (height - start.height)
      };
    }
    case 'top-right': {
      const width = Math.min(
        bounds.maxWidth,
        Math.max(min.minWidth, start.width + delta.deltaX)
      );
      const height = Math.min(
        bounds.maxHeight,
        Math.max(min.minHeight, start.height - delta.deltaY)
      );
      return {
        width,
        height,
        x: start.x,
        y: start.y - (height - start.height)
      };
    }
    case 'bottom-left': {
      const width = Math.min(
        bounds.maxWidth,
        Math.max(min.minWidth, start.width - delta.deltaX)
      );
      const height = Math.min(
        bounds.maxHeight,
        Math.max(min.minHeight, start.height + delta.deltaY)
      );
      return {
        width,
        height,
        x: start.x - (width - start.width),
        y: start.y
      };
    }
    case 'bottom-right': {
      return {
        width: Math.min(
          bounds.maxWidth,
          Math.max(min.minWidth, start.width + delta.deltaX)
        ),
        height: Math.min(
          bounds.maxHeight,
          Math.max(min.minHeight, start.height + delta.deltaY)
        ),
        x: start.x,
        y: start.y
      };
    }
  }
}
