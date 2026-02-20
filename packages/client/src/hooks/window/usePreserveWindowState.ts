import {
  getPreserveWindowState,
  setPreserveWindowState,
  subscribePreserveWindowState
} from '@tearleads/window-manager';
import { useCallback, useSyncExternalStore } from 'react';

export function usePreserveWindowState() {
  const preserveWindowState = useSyncExternalStore(
    subscribePreserveWindowState,
    getPreserveWindowState,
    getPreserveWindowState
  );

  const updatePreserveWindowState = useCallback((next: boolean) => {
    setPreserveWindowState(next);
  }, []);

  return {
    preserveWindowState,
    setPreserveWindowState: updatePreserveWindowState
  };
}
