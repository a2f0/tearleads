import type { Corner } from '../../hooks/useFloatingWindow.js';

export const DESKTOP_BREAKPOINT = 768;
export const MAX_FIT_CONTENT_ATTEMPTS = 5;
export const NEAR_MAXIMIZED_INSET = 16;

export const POSITION_CLASSES: Record<Corner, string> = {
  'top-left': 'top-0 left-0',
  'top-right': 'top-0 right-0',
  'bottom-left': 'bottom-0 left-0',
  'bottom-right': 'bottom-0 right-0'
};

export const BORDER_CLASSES: Record<Corner, string> = {
  'top-left': 'border-t-2 border-l-2 rounded-tl-lg',
  'top-right': 'border-t-2 border-r-2 rounded-tr-lg',
  'bottom-left': 'border-b-2 border-l-2 rounded-bl-lg',
  'bottom-right': 'border-b-2 border-r-2 rounded-br-lg'
};
