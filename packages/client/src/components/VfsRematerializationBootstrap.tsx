import { useEffect, useRef } from 'react';
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

  useEffect(() => {
    let cancelled = false;

    const runRematerialization = () => {
      if (
        cancelled ||
        !isAuthenticated ||
        !isReady ||
        inFlightRef.current ||
        retryTimerRef.current
      ) {
        return;
      }

      inFlightRef.current = true;
      void rematerializeRemoteVfsStateIfNeeded()
        .then(() => {
          retryDelayMsRef.current = INITIAL_RETRY_DELAY_MS;
        })
        .catch((error) => {
          console.warn('VFS rematerialization bootstrap failed:', error);
          const delayMs = retryDelayMsRef.current;
          retryDelayMsRef.current = Math.min(
            retryDelayMsRef.current * 2,
            MAX_RETRY_DELAY_MS
          );
          retryTimerRef.current = setTimeout(() => {
            retryTimerRef.current = null;
            inFlightRef.current = false;
            runRematerialization();
          }, delayMs);
        })
        .finally(() => {
          if (!retryTimerRef.current) {
            inFlightRef.current = false;
          }
        });
    };

    runRematerialization();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, isReady]);

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
