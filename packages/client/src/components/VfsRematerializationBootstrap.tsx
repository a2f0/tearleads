import { useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useVfsOrchestrator } from '@/contexts/VfsOrchestratorContext';
import { useDatabaseContext } from '@/db/hooks';
import { getInstanceChangeSnapshot } from '@/hooks/app/useInstanceChange';
import { rematerializeRemoteVfsStateIfNeeded } from '@/lib/vfsRematerialization';

const INITIAL_RETRY_DELAY_MS = 2_000;
const MAX_RETRY_DELAY_MS = 60_000;

export function VfsRematerializationBootstrap() {
  const { isAuthenticated } = useAuth();
  const { isReady } = useVfsOrchestrator();
  const { currentInstanceId, db, isLoading } = useDatabaseContext();
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryDelayMsRef = useRef(INITIAL_RETRY_DELAY_MS);
  const inFlightRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const clearRetryTimer = () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };

    if (
      !isAuthenticated ||
      !isReady ||
      isLoading ||
      !db ||
      !currentInstanceId
    ) {
      clearRetryTimer();
      retryDelayMsRef.current = INITIAL_RETRY_DELAY_MS;
      inFlightRef.current = false;
      return () => {
        cancelled = true;
      };
    }

    const runRematerialization = () => {
      if (cancelled || inFlightRef.current || retryTimerRef.current) {
        return;
      }

      const operationSnapshot = getInstanceChangeSnapshot();
      inFlightRef.current = true;
      void rematerializeRemoteVfsStateIfNeeded()
        .then(() => {
          if (
            getInstanceChangeSnapshot().instanceEpoch !==
            operationSnapshot.instanceEpoch
          ) {
            return;
          }
          retryDelayMsRef.current = INITIAL_RETRY_DELAY_MS;
        })
        .catch((error) => {
          const currentSnapshot = getInstanceChangeSnapshot();
          if (
            currentSnapshot.instanceEpoch !== operationSnapshot.instanceEpoch
          ) {
            return;
          }

          console.warn(
            'VFS rematerialization bootstrap failed:',
            `instanceEpoch=${operationSnapshot.instanceEpoch}, currentInstanceEpoch=${currentSnapshot.instanceEpoch}, instanceId=${operationSnapshot.currentInstanceId ?? 'none'}`,
            error
          );
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
      clearRetryTimer();
      inFlightRef.current = false;
    };
  }, [currentInstanceId, db, isAuthenticated, isLoading, isReady]);

  return null;
}
