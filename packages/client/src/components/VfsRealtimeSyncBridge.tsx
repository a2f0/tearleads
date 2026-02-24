import { useCallback, useEffect, useRef } from 'react';
import { useVfsOrchestratorInstance } from '@/contexts/VfsOrchestratorContext';
import { useSSE } from '@/sse';

const CHANNEL_REFRESH_INTERVAL_MS = 15000;
const MAX_REALTIME_CHANNELS = 500;
const SYNC_DEBOUNCE_MS = 150;
const BASE_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 30000;

function isSameStringArray(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
}

function isVfsContainerSyncChannel(channel: string): boolean {
  return channel.startsWith('vfs:container:') && channel.endsWith(':sync');
}

function buildChannelList(
  orchestrator: ReturnType<typeof useVfsOrchestratorInstance>
): string[] {
  if (!orchestrator) {
    return ['broadcast'];
  }

  const result = orchestrator.crdt.listChangedContainers(
    null,
    MAX_REALTIME_CHANNELS
  );
  const channels = result.items
    .map((item) => `vfs:container:${item.containerId}:sync`)
    .sort((left, right) => left.localeCompare(right));

  return ['broadcast', ...channels];
}

function computeRetryDelayWithJitter(attempt: number): number {
  const attemptIndex = Number.isInteger(attempt) && attempt > 0 ? attempt : 0;
  const exponentialCeiling = Math.min(
    BASE_RETRY_DELAY_MS * 2 ** attemptIndex,
    MAX_RETRY_DELAY_MS
  );
  const jitterFloor = Math.max(
    BASE_RETRY_DELAY_MS,
    Math.floor(exponentialCeiling / 2)
  );
  const jitterRange = Math.max(0, exponentialCeiling - jitterFloor);
  return jitterFloor + Math.floor(Math.random() * (jitterRange + 1));
}

export function VfsRealtimeSyncBridge() {
  const { connect, lastMessage } = useSSE();
  const orchestrator = useVfsOrchestratorInstance();

  const connectedChannelsRef = useRef<string[]>([]);
  const pendingSyncRef = useRef(false);
  const syncInFlightRef = useRef(false);
  const retryAttemptRef = useRef(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSyncIfNeeded = useCallback(async () => {
    if (!orchestrator || syncInFlightRef.current || !pendingSyncRef.current) {
      return;
    }

    pendingSyncRef.current = false;
    syncInFlightRef.current = true;
    try {
      await orchestrator.syncCrdt();
      retryAttemptRef.current = 0;
    } catch {
      pendingSyncRef.current = true;
      if (!retryTimerRef.current) {
        const retryDelayMs = computeRetryDelayWithJitter(
          retryAttemptRef.current
        );
        retryAttemptRef.current += 1;
        retryTimerRef.current = setTimeout(() => {
          retryTimerRef.current = null;
          void runSyncIfNeeded();
        }, retryDelayMs);
      }
    } finally {
      syncInFlightRef.current = false;
      if (pendingSyncRef.current && !retryTimerRef.current) {
        void runSyncIfNeeded();
      }
    }
  }, [orchestrator]);

  const scheduleSync = useCallback(() => {
    pendingSyncRef.current = true;
    if (retryTimerRef.current || debounceTimerRef.current) {
      return;
    }

    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      void runSyncIfNeeded();
    }, SYNC_DEBOUNCE_MS);
  }, [runSyncIfNeeded]);

  useEffect(() => {
    const refreshChannels = () => {
      const nextChannels = buildChannelList(orchestrator);
      if (isSameStringArray(nextChannels, connectedChannelsRef.current)) {
        return;
      }

      connectedChannelsRef.current = nextChannels;
      connect(nextChannels);
    };

    refreshChannels();
    const refreshTimer = setInterval(
      refreshChannels,
      CHANNEL_REFRESH_INTERVAL_MS
    );
    return () => {
      clearInterval(refreshTimer);
    };
  }, [connect, orchestrator]);

  useEffect(() => {
    const nextMessage = lastMessage;
    if (!orchestrator || !nextMessage) {
      return;
    }

    if (
      nextMessage.message.type !== 'vfs:cursor-bump' ||
      !isVfsContainerSyncChannel(nextMessage.channel)
    ) {
      return;
    }

    scheduleSync();
  }, [lastMessage, orchestrator, scheduleSync]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, []);

  return null;
}
