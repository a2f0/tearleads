import { useCallback } from "react";
import { useSystemStatusSnapshot } from "../../../components/pane/status/useSystemStatusSnapshot";
import { useSystemEnvironment } from "../environment/useSystemEnvironment";
import { useSystemMonitorFeatureFlagRows } from "../feature-flags/useSystemMonitorFeatureFlagRows";
import { useSystemMonitorLogEntries } from "../log/useSystemMonitorLogEntries";
import { formatSystemMonitorReport } from "./systemMonitorReport";
import { useSystemMonitorQueueMetadata } from "./useSystemMonitorQueueMetadata";

/**
 * Builds the support report covering every System Monitor tab.
 *
 * Every tab's data is read here, in the monitor's root, rather than in the tabs
 * themselves: the toolbar copy action must capture all of them no matter which
 * one is mounted. Most of these are free context reads; the
 * write-queue/sync-lane metadata is the exception — it keeps a throttled
 * subscription alive while the monitor is open (see `useSystemMonitorQueueMetadata`)
 * so the report can capture it synchronously on click.
 *
 * Returns a builder rather than the report string, so the (potentially large)
 * log serialization runs on click instead of on every render — and so the
 * capture timestamp is the moment the user pressed copy.
 */
export function useSystemMonitorReport({
  includeFeatureFlags,
}: {
  includeFeatureFlags: boolean;
}): () => string {
  const environment = useSystemEnvironment();
  const status = useSystemStatusSnapshot();
  const logEntries = useSystemMonitorLogEntries();
  const featureFlags = useSystemMonitorFeatureFlagRows();
  const { syncLanes, writeQueue } = useSystemMonitorQueueMetadata();

  return useCallback(
    () =>
      formatSystemMonitorReport({
        capturedAt: new Date().toISOString(),
        environment,
        // Omitted outside developer mode, matching the tab the user can see.
        featureFlags: includeFeatureFlags ? featureFlags : undefined,
        logEntries,
        status,
        syncLanes,
        writeQueue,
      }),
    [
      environment,
      featureFlags,
      includeFeatureFlags,
      logEntries,
      status,
      syncLanes,
      writeQueue,
    ],
  );
}
