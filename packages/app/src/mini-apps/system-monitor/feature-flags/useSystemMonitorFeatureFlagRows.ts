import { useMemo } from "react";
import { useAppFeatureFlags } from "../../../providers/feature-flags/AppFeatureFlagsProvider";
import {
  APP_FEATURE_FLAG_IDS,
  type AppFeatureFlagId,
} from "../../../providers/feature-flags/appFeatureFlags";
import type { SystemMonitorReportFlag } from "../report/systemMonitorReport";

// Shared with SystemMonitorFeatureFlags so the support report names each flag
// exactly as its toggle does. Each label is the action its switch performs
// (Show, Hide, Enable), used as both the row text and the switch's name.
export const FEATURE_FLAG_DETAILS = {
  "built-in-system-containers": { label: "Show built-in system containers" },
  "document-edit-ranges": { label: "Show document edit ranges" },
  "explorer-header-sync-indicator": {
    label: "Show Explorer header sync indicator",
  },
  "hide-org-manager-system-grants": { label: "Hide Org Manager system grants" },
  "linked-document-activation-controls": {
    label: "Enable linked document activation controls",
  },
  "stripe-hosted-checkout": { label: "Show Pay on Stripe link" },
  "workspace-switcher": { label: "Show workspace switcher" },
} as const satisfies Record<AppFeatureFlagId, { label: string }>;

const FEATURE_FLAG_ENABLED = "Enabled";
const FEATURE_FLAG_DISABLED = "Disabled";

export function formatFeatureFlagState(enabled: boolean): string {
  return enabled ? FEATURE_FLAG_ENABLED : FEATURE_FLAG_DISABLED;
}

/** The Feature Flags tab's contents as plain data, for the support report. */
export function useSystemMonitorFeatureFlagRows(): ReadonlyArray<SystemMonitorReportFlag> {
  const { isEnabled } = useAppFeatureFlags();

  return useMemo(
    () =>
      APP_FEATURE_FLAG_IDS.map((flag) => ({
        label: FEATURE_FLAG_DETAILS[flag].label,
        value: formatFeatureFlagState(isEnabled(flag)),
      })),
    [isEnabled],
  );
}
