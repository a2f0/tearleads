import { useCallback, useSyncExternalStore } from 'react';
import {
  getPreserveWindowState,
  setPreserveWindowState,
  subscribePreserveWindowState
} from '@/lib/windowStatePreference';

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
