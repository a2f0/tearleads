import { useMemo } from "react";
import { useAppFeatureFlags } from "../../../providers/feature-flags/AppFeatureFlagsProvider";
import type { SystemMonitorReportFlag } from "../report/systemMonitorReport";

// Shared with SystemMonitorFeatureFlags so the support report names each flag
// exactly as its toggle does.
export const FEATURE_FLAG_LABELS = {
  builtInSystemContainers: "Built-in system containers",
  documentEditRanges: "Document edit ranges",
  explorerHeaderSyncIndicator: "Explorer header sync indicator",
  linkedDocumentActivationControls: "Linked document activation controls",
  workspaceSwitcher: "Workspace switcher",
} as const;

const FEATURE_FLAG_ENABLED = "Enabled";
const FEATURE_FLAG_DISABLED = "Disabled";

export function formatFeatureFlagState(enabled: boolean): string {
  return enabled ? FEATURE_FLAG_ENABLED : FEATURE_FLAG_DISABLED;
}

/** The Feature Flags tab's contents as plain data, for the support report. */
export function useSystemMonitorFeatureFlagRows(): ReadonlyArray<SystemMonitorReportFlag> {
  const {
    builtInSystemContainersVisible,
    documentEditRangesVisible,
    explorerHeaderSyncIndicatorVisible,
    linkedDocumentActivationControlsEnabled,
    workspaceSwitcherVisible,
  } = useAppFeatureFlags();

  return useMemo(
    () => [
      {
        label: FEATURE_FLAG_LABELS.builtInSystemContainers,
        value: formatFeatureFlagState(builtInSystemContainersVisible),
      },
      {
        label: FEATURE_FLAG_LABELS.documentEditRanges,
        value: formatFeatureFlagState(documentEditRangesVisible),
      },
      {
        label: FEATURE_FLAG_LABELS.explorerHeaderSyncIndicator,
        value: formatFeatureFlagState(explorerHeaderSyncIndicatorVisible),
      },
      {
        label: FEATURE_FLAG_LABELS.linkedDocumentActivationControls,
        value: formatFeatureFlagState(linkedDocumentActivationControlsEnabled),
      },
      {
        label: FEATURE_FLAG_LABELS.workspaceSwitcher,
        value: formatFeatureFlagState(workspaceSwitcherVisible),
      },
    ],
    [
      builtInSystemContainersVisible,
      documentEditRangesVisible,
      explorerHeaderSyncIndicatorVisible,
      linkedDocumentActivationControlsEnabled,
      workspaceSwitcherVisible,
    ],
  );
}
