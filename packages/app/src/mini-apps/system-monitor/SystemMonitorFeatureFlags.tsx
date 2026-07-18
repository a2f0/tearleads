import { useId } from "react";
import {
  MiniAppSection,
  MiniAppSectionHeading,
} from "../../components/mini-app/MiniAppLayout";
import { useAppFeatureFlags } from "../../providers/feature-flags/AppFeatureFlagsProvider";
import {
  FEATURE_FLAG_LABELS,
  formatFeatureFlagState,
} from "./useSystemMonitorFeatureFlagRows";

export function SystemMonitorFeatureFlags() {
  const {
    builtInSystemContainersVisible,
    linkedDocumentActivationControlsEnabled,
    setBuiltInSystemContainersVisible,
    setLinkedDocumentActivationControlsEnabled,
  } = useAppFeatureFlags();
  const builtInSystemContainersToggleId = useId();
  const linkedDocumentActivationControlsToggleId = useId();

  return (
    <MiniAppSection className="system-monitor-feature-flags">
      <MiniAppSectionHeading>
        <h2>Feature Flags</h2>
      </MiniAppSectionHeading>
      <label
        className="system-monitor-feature-flag"
        htmlFor={builtInSystemContainersToggleId}
      >
        <span className="system-monitor-feature-flag-name">
          {FEATURE_FLAG_LABELS.builtInSystemContainers}
        </span>
        <span className="system-monitor-feature-flag-control">
          <span className="system-monitor-feature-flag-state">
            {formatFeatureFlagState(builtInSystemContainersVisible)}
          </span>
          <input
            aria-checked={builtInSystemContainersVisible}
            aria-label="Show built-in system containers"
            checked={builtInSystemContainersVisible}
            className="system-monitor-feature-flag-switch"
            id={builtInSystemContainersToggleId}
            role="switch"
            type="checkbox"
            onChange={(event) => {
              setBuiltInSystemContainersVisible(event.currentTarget.checked);
            }}
          />
        </span>
      </label>
      <label
        className="system-monitor-feature-flag"
        htmlFor={linkedDocumentActivationControlsToggleId}
      >
        <span className="system-monitor-feature-flag-name">
          {FEATURE_FLAG_LABELS.linkedDocumentActivationControls}
        </span>
        <span className="system-monitor-feature-flag-control">
          <span className="system-monitor-feature-flag-state">
            {formatFeatureFlagState(linkedDocumentActivationControlsEnabled)}
          </span>
          <input
            aria-checked={linkedDocumentActivationControlsEnabled}
            aria-label="Enable linked document activation controls"
            checked={linkedDocumentActivationControlsEnabled}
            className="system-monitor-feature-flag-switch"
            id={linkedDocumentActivationControlsToggleId}
            role="switch"
            type="checkbox"
            onChange={(event) => {
              setLinkedDocumentActivationControlsEnabled(
                event.currentTarget.checked,
              );
            }}
          />
        </span>
      </label>
    </MiniAppSection>
  );
}
