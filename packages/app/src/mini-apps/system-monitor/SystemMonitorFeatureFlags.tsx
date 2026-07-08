import { useId } from "react";
import {
  MiniAppSection,
  MiniAppSectionHeading,
} from "../../components/shared/MiniAppLayout";
import { useAppFeatureFlags } from "../../providers/feature-flags/AppFeatureFlagsProvider";

export function SystemMonitorFeatureFlags() {
  const {
    builtInSystemContainersVisible,
    linkedDocumentActivationControlsEnabled,
    passkeysEnabled,
    setBuiltInSystemContainersVisible,
    setLinkedDocumentActivationControlsEnabled,
    setPasskeysEnabled,
  } = useAppFeatureFlags();
  const builtInSystemContainersToggleId = useId();
  const linkedDocumentActivationControlsToggleId = useId();
  const passkeysToggleId = useId();

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
          Built-in system containers
        </span>
        <span className="system-monitor-feature-flag-control">
          <span className="system-monitor-feature-flag-state">
            {builtInSystemContainersVisible ? "Enabled" : "Disabled"}
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
      <label className="system-monitor-feature-flag" htmlFor={passkeysToggleId}>
        <span className="system-monitor-feature-flag-name">Passkeys</span>
        <span className="system-monitor-feature-flag-control">
          <span className="system-monitor-feature-flag-state">
            {passkeysEnabled ? "Enabled" : "Disabled"}
          </span>
          <input
            aria-checked={passkeysEnabled}
            aria-label="Enable passkeys"
            checked={passkeysEnabled}
            className="system-monitor-feature-flag-switch"
            id={passkeysToggleId}
            role="switch"
            type="checkbox"
            onChange={(event) => {
              setPasskeysEnabled(event.currentTarget.checked);
            }}
          />
        </span>
      </label>
      <label
        className="system-monitor-feature-flag"
        htmlFor={linkedDocumentActivationControlsToggleId}
      >
        <span className="system-monitor-feature-flag-name">
          Linked document activation controls
        </span>
        <span className="system-monitor-feature-flag-control">
          <span className="system-monitor-feature-flag-state">
            {linkedDocumentActivationControlsEnabled ? "Enabled" : "Disabled"}
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
