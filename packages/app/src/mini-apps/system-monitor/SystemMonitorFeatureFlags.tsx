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
    documentEditRangesVisible,
    linkedDocumentActivationControlsEnabled,
    setBuiltInSystemContainersVisible,
    setDocumentEditRangesVisible,
    setLinkedDocumentActivationControlsEnabled,
    setWorkspaceSwitcherVisible,
    workspaceSwitcherVisible,
  } = useAppFeatureFlags();
  const builtInSystemContainersToggleId = useId();
  const documentEditRangesToggleId = useId();
  const linkedDocumentActivationControlsToggleId = useId();
  const workspaceSwitcherToggleId = useId();

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
        htmlFor={documentEditRangesToggleId}
      >
        <span className="system-monitor-feature-flag-name">
          {FEATURE_FLAG_LABELS.documentEditRanges}
        </span>
        <span className="system-monitor-feature-flag-control">
          <span className="system-monitor-feature-flag-state">
            {formatFeatureFlagState(documentEditRangesVisible)}
          </span>
          <input
            aria-checked={documentEditRangesVisible}
            aria-label="Show document edit ranges"
            checked={documentEditRangesVisible}
            className="system-monitor-feature-flag-switch"
            id={documentEditRangesToggleId}
            role="switch"
            type="checkbox"
            onChange={(event) => {
              setDocumentEditRangesVisible(event.currentTarget.checked);
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
      <label
        className="system-monitor-feature-flag"
        htmlFor={workspaceSwitcherToggleId}
      >
        <span className="system-monitor-feature-flag-name">
          {FEATURE_FLAG_LABELS.workspaceSwitcher}
        </span>
        <span className="system-monitor-feature-flag-control">
          <span className="system-monitor-feature-flag-state">
            {formatFeatureFlagState(workspaceSwitcherVisible)}
          </span>
          <input
            aria-checked={workspaceSwitcherVisible}
            aria-label="Show workspace switcher"
            checked={workspaceSwitcherVisible}
            className="system-monitor-feature-flag-switch"
            id={workspaceSwitcherToggleId}
            role="switch"
            type="checkbox"
            onChange={(event) => {
              setWorkspaceSwitcherVisible(event.currentTarget.checked);
            }}
          />
        </span>
      </label>
    </MiniAppSection>
  );
}
