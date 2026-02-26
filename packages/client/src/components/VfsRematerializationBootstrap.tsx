import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useVfsOrchestrator } from '@/contexts/VfsOrchestratorContext';
import { rematerializeRemoteVfsStateIfNeeded } from '@/lib/vfsRematerialization';

const INITIAL_RETRY_DELAY_MS = 2_000;
const MAX_RETRY_DELAY_MS = 60_000;

export function VfsRematerializationBootstrap() {
  const { isAuthenticated } = useAuth();
  const { isReady } = useVfsOrchestrator();
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryDelayMsRef = useRef(INITIAL_RETRY_DELAY_MS);
  const inFlightRef = useRef(false);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    if (!isAuthenticated || !isReady || inFlightRef.current) {
      return;
    }
    inFlightRef.current = true;
    void rematerializeRemoteVfsStateIfNeeded()
      .then(() => {
        retryDelayMsRef.current = INITIAL_RETRY_DELAY_MS;
      })
      .catch((error) => {
        console.warn('VFS rematerialization bootstrap failed:', error);
        if (!retryTimerRef.current) {
          const delayMs = retryDelayMsRef.current;
          retryDelayMsRef.current = Math.min(
            retryDelayMsRef.current * 2,
            MAX_RETRY_DELAY_MS
          );
          retryTimerRef.current = setTimeout(() => {
            retryTimerRef.current = null;
            inFlightRef.current = false;
            setRetryNonce((value) => value + 1);
          }, delayMs);
          return;
        }
      })
      .finally(() => {
        if (!retryTimerRef.current) {
          inFlightRef.current = false;
        }
      });
  }, [isAuthenticated, isReady, retryNonce]);

  useEffect(() => {
    return () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, []);

  return null;
}
