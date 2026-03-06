import { useCallback, useEffect, useRef } from 'react';
import { useVfsOrchestratorInstance } from '@/contexts/VfsOrchestratorContext';
import { useVfsSyncState } from '@/contexts/VfsSyncStateContext';
import { hasActiveOrganizationId, onOrgChange } from '@/lib/orgStorage';
import { createRemoteReadOrchestrator } from '@/lib/remoteReadOrchestrator';
import { withDownloadTracking } from '@/lib/vfsItemSyncWriter';
import { hydrateLocalReadModelFromRemoteFeeds } from '@/lib/vfsReadModelHydration';
import { useSSE } from '@/sse';
import { logStore } from '@/stores/logStore';

const CHANNEL_REFRESH_INTERVAL_MS = 15000;
const MAX_REALTIME_CHANNELS = 500;
const SYNC_DEBOUNCE_MS = 150;
const BASE_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 30000;
const SYNC_SCOPE = 'vfs-realtime-sync';

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

function parseContainerIdFromChannel(channel: string): string | null {
  const matches = /^vfs:container:(.+):sync$/.exec(channel);
  return matches?.[1] ?? null;
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
  const { refresh: refreshSyncState } = useVfsSyncState();
  const hasObservedOrchestratorRef = useRef(false);
  const previousNonNullOrchestratorRef = useRef(orchestrator);

  const connectedChannelsRef = useRef<string[]>([]);
  const remoteReadOrchestratorRef = useRef(
    createRemoteReadOrchestrator<void>()
  );
  const retryAttemptRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleSync = useCallback(() => {
    if (!orchestrator || retryTimerRef.current) {
      return;
    }

    void remoteReadOrchestratorRef.current
      .schedule(
        async () => {
          await withDownloadTracking(async () => {
            await orchestrator.syncCrdt();
            await hydrateLocalReadModelFromRemoteFeeds();
            refreshSyncState();
          });
          retryAttemptRef.current = 0;
        },
        {
          scope: SYNC_SCOPE,
          debounceMs: SYNC_DEBOUNCE_MS,
          coalesceInFlight: true
        }
      )
      .catch(() => {
        if (retryTimerRef.current) {
          return;
        }

        const retryDelayMs = computeRetryDelayWithJitter(
          retryAttemptRef.current
        );
        logStore.warn(
          'VFS CRDT sync failed after SSE trigger; scheduling retry',
          `attempt=${retryAttemptRef.current + 1}, retryDelayMs=${retryDelayMs}`
        );
        retryAttemptRef.current += 1;
        retryTimerRef.current = setTimeout(() => {
          retryTimerRef.current = null;
          scheduleSync();
        }, retryDelayMs);
      });
  }, [orchestrator, refreshSyncState]);

  useEffect(() => {
    if (!orchestrator) {
      return;
    }

    if (
      hasObservedOrchestratorRef.current &&
      previousNonNullOrchestratorRef.current !== orchestrator
    ) {
      scheduleSync();
    }

    hasObservedOrchestratorRef.current = true;
    previousNonNullOrchestratorRef.current = orchestrator;
  }, [orchestrator, scheduleSync]);

  useEffect(() => {
    if (!orchestrator) {
      return;
    }

    const syncWhenOrganizationReady = () => {
      if (!hasActiveOrganizationId()) {
        return;
      }
      scheduleSync();
    };

    syncWhenOrganizationReady();
    return onOrgChange(syncWhenOrganizationReady);
  }, [orchestrator, scheduleSync]);

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

    const containerId = parseContainerIdFromChannel(nextMessage.channel);
    logStore.info(
      'VFS SSE cursor bump received; triggering CRDT sync',
      containerId
        ? `channel=${nextMessage.channel}, containerId=${containerId}`
        : `channel=${nextMessage.channel}`
    );
    scheduleSync();
  }, [lastMessage, orchestrator, scheduleSync]);

  useEffect(() => {
    return () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      remoteReadOrchestratorRef.current.cancelInFlight(SYNC_SCOPE);
    };
  }, []);

  return null;
}
