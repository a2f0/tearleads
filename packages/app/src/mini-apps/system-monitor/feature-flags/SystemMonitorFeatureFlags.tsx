import { useId } from "react";
import {
  MiniAppSection,
  MiniAppSectionHeading,
} from "../../../components/mini-app/MiniAppLayout";
import { useAppFeatureFlags } from "../../../providers/feature-flags/AppFeatureFlagsProvider";
import {
  FEATURE_FLAG_LABELS,
  formatFeatureFlagState,
} from "./useSystemMonitorFeatureFlagRows";

// One flag's row: the name, its current state as text, and the switch. Every
// flag renders identically, so the row owns its own `useId` rather than making
// the panel below thread one per flag.
function SystemMonitorFeatureFlagToggle({
  enabled,
  label,
  onChange,
  switchLabel,
}: {
  enabled: boolean;
  label: string;
  onChange: (enabled: boolean) => void;
  // The switch's accessible name, phrased as the action it performs — it is
  // what tests and screen readers address the control by, so it stays distinct
  // from the row's display label.
  switchLabel: string;
}) {
  const toggleId = useId();

  return (
    <label className="system-monitor-feature-flag" htmlFor={toggleId}>
      <span className="system-monitor-feature-flag-name">{label}</span>
      <span className="system-monitor-feature-flag-control">
        <span className="system-monitor-feature-flag-state">
          {formatFeatureFlagState(enabled)}
        </span>
        <input
          aria-checked={enabled}
          aria-label={switchLabel}
          checked={enabled}
          className="system-monitor-feature-flag-switch"
          id={toggleId}
          role="switch"
          type="checkbox"
          onChange={(event) => {
            onChange(event.currentTarget.checked);
          }}
        />
      </span>
    </label>
  );
}

export function SystemMonitorFeatureFlags() {
  const {
    builtInSystemContainersVisible,
    documentEditRangesVisible,
    explorerHeaderSyncIndicatorVisible,
    linkedDocumentActivationControlsEnabled,
    setBuiltInSystemContainersVisible,
    setDocumentEditRangesVisible,
    setExplorerHeaderSyncIndicatorVisible,
    setLinkedDocumentActivationControlsEnabled,
    setWorkspaceSwitcherVisible,
    workspaceSwitcherVisible,
  } = useAppFeatureFlags();

  return (
    <MiniAppSection className="system-monitor-feature-flags">
      <MiniAppSectionHeading>
        <h2>Feature Flags</h2>
      </MiniAppSectionHeading>
      <SystemMonitorFeatureFlagToggle
        enabled={builtInSystemContainersVisible}
        label={FEATURE_FLAG_LABELS.builtInSystemContainers}
        onChange={setBuiltInSystemContainersVisible}
        switchLabel="Show built-in system containers"
      />
      <SystemMonitorFeatureFlagToggle
        enabled={documentEditRangesVisible}
        label={FEATURE_FLAG_LABELS.documentEditRanges}
        onChange={setDocumentEditRangesVisible}
        switchLabel="Show document edit ranges"
      />
      <SystemMonitorFeatureFlagToggle
        enabled={explorerHeaderSyncIndicatorVisible}
        label={FEATURE_FLAG_LABELS.explorerHeaderSyncIndicator}
        onChange={setExplorerHeaderSyncIndicatorVisible}
        switchLabel="Show Explorer header sync indicator"
      />
      <SystemMonitorFeatureFlagToggle
        enabled={linkedDocumentActivationControlsEnabled}
        label={FEATURE_FLAG_LABELS.linkedDocumentActivationControls}
        onChange={setLinkedDocumentActivationControlsEnabled}
        switchLabel="Enable linked document activation controls"
      />
      <SystemMonitorFeatureFlagToggle
        enabled={workspaceSwitcherVisible}
        label={FEATURE_FLAG_LABELS.workspaceSwitcher}
        onChange={setWorkspaceSwitcherVisible}
        switchLabel="Show workspace switcher"
      />
    </MiniAppSection>
  );
}
