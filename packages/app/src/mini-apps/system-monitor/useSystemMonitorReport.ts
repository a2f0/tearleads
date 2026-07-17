import { useCallback } from "react";
import { useSystemStatusSnapshot } from "../../components/pane/status/useSystemStatusSnapshot";
import { formatSystemMonitorReport } from "./systemMonitorReport";
import { useSystemEnvironment } from "./useSystemEnvironment";
import { useSystemMonitorFeatureFlagRows } from "./useSystemMonitorFeatureFlagRows";
import { useSystemMonitorLogEntries } from "./useSystemMonitorLogEntries";

/**
 * Builds the support report covering every System Monitor tab.
 *
 * Every tab's data is read here, in the monitor's root, rather than in the tabs
 * themselves: the copy button sits in the tab bar and must capture all of them
 * no matter which one is mounted. These are all context reads, so gathering
 * them unconditionally costs nothing.
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

  return useCallback(
    () =>
      formatSystemMonitorReport({
        capturedAt: new Date().toISOString(),
        environment,
        // Omitted outside developer mode, matching the tab the user can see.
        featureFlags: includeFeatureFlags ? featureFlags : undefined,
        logEntries,
        status,
      }),
    [environment, featureFlags, includeFeatureFlags, logEntries, status],
  );
}
