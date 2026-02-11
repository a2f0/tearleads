import { useContext } from 'react';
import type { WindowManagerContextValue } from './types.js';
import { WindowManagerContext } from './WindowManagerContext.js';

export function useWindowManager(): WindowManagerContextValue {
  const context = useContext(WindowManagerContext);
  if (!context) {
    throw new Error(
      'useWindowManager must be used within a WindowManagerProvider'
    );
  }
  return context;
}
