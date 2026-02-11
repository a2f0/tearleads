import { createContext } from 'react';
import type { WindowManagerContextValue } from './types.js';

export const WindowManagerContext =
  createContext<WindowManagerContextValue | null>(null);
