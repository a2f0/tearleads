import type { Corner } from '../../hooks/useFloatingWindow.js';

export const DESKTOP_BREAKPOINT = 768;
export const MAX_FIT_CONTENT_ATTEMPTS = 5;
export const NEAR_MAXIMIZED_INSET = 16;

export const POSITION_CLASSES: Record<Corner, string> = {
  'top-left': '-top-1 -left-1',
  'top-right': '-top-1 -right-1',
  'bottom-left': '-bottom-1 -left-1',
  'bottom-right': '-bottom-1 -right-1'
};

export const BORDER_CLASSES: Record<Corner, string> = {
  'top-left': 'border-t-2 border-l-2 rounded-tl-lg',
  'top-right': 'border-t-2 border-r-2 rounded-tr-lg',
  'bottom-left': 'border-b-2 border-l-2 rounded-bl-lg',
  'bottom-right': 'border-b-2 border-r-2 rounded-br-lg'
};
