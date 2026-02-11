import type { Corner } from './types.js';

export function getCursorForCorner(corner: Corner): string {
  switch (corner) {
    case 'top-left':
      return 'nwse-resize';
    case 'top-right':
      return 'nesw-resize';
    case 'bottom-left':
      return 'nesw-resize';
    case 'bottom-right':
      return 'nwse-resize';
  }
}
