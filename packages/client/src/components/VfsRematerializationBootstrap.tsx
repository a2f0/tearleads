import { useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useVfsOrchestrator } from '@/contexts/VfsOrchestratorContext';
import { useDatabaseContext } from '@/db/hooks';
import { getInstanceChangeSnapshot } from '@/hooks/app/useInstanceChange';
import { rematerializeRemoteVfsStateIfNeeded } from '@/lib/vfsRematerialization';
import { isVfsRuntimeDatabaseReady } from '@/lib/vfsRuntimeDatabaseGate';

const INITIAL_RETRY_DELAY_MS = 2_000;
const MAX_RETRY_DELAY_MS = 60_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hasExactNumericField(
  value: Record<string, unknown>,
  field: string,
  expected: number
): boolean {
  return typeof value[field] === 'number' && value[field] === expected;
}

function renderErrorMessage(error: unknown): string {
  if (typeof error === 'string') {
    return error;
  }

  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  if (!isRecord(error)) {
    return '';
  }

  const name = typeof error['name'] === 'string' ? error['name'] : '';
  const message = typeof error['message'] === 'string' ? error['message'] : '';

  return `${name} ${message}`.trim();
}

function isUnauthorizedBootstrapError(error: unknown): boolean {
  if (isRecord(error)) {
    if (
      hasExactNumericField(error, 'status', 401) ||
      hasExactNumericField(error, 'statusCode', 401) ||
      hasExactNumericField(error, 'code', 401)
    ) {
      return true;
    }

    const code = error['code'];
    if (typeof code === 'string') {
      const normalizedCode = code.toLowerCase();
      if (
        normalizedCode === 'unauthorized' ||
        normalizedCode === 'unauthenticated'
      ) {
        return true;
      }
    }
  }

  const renderedMessage = renderErrorMessage(error).toLowerCase();
  return (
    renderedMessage.includes('unauthorized') ||
    renderedMessage.includes('unauthenticated') ||
    /api error:\s*401\b/iu.test(renderedMessage)
  );
}

export function VfsRematerializationBootstrap() {
  const { isAuthenticated, token, user } = useAuth();
  const { isReady } = useVfsOrchestrator();
  const databaseContext = useDatabaseContext();
  const currentInstanceId = databaseContext.currentInstanceId;
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryDelayMsRef = useRef(INITIAL_RETRY_DELAY_MS);
  const inFlightRef = useRef(false);
  const isDatabaseReady = isVfsRuntimeDatabaseReady({
    databaseContext,
    userId: user?.id ?? null
  });

  useEffect(() => {
    let cancelled = false;
    const clearRetryTimer = () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };

    if (!isReady || !isDatabaseReady || !isAuthenticated || !token) {
      clearRetryTimer();
      retryDelayMsRef.current = INITIAL_RETRY_DELAY_MS;
      inFlightRef.current = false;
      return () => {
        cancelled = true;
      };
    }

    const runRematerialization = () => {
      if (
        cancelled ||
        inFlightRef.current ||
        retryTimerRef.current ||
        getInstanceChangeSnapshot().currentInstanceId !== currentInstanceId
      ) {
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
          if (isUnauthorizedBootstrapError(error)) {
            retryDelayMsRef.current = INITIAL_RETRY_DELAY_MS;
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
  }, [currentInstanceId, isAuthenticated, isDatabaseReady, isReady, token]);

  return null;
}
