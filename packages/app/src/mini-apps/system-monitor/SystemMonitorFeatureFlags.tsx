import { useId } from "react";
import {
  MiniAppSection,
  MiniAppSectionHeading,
} from "../../components/shared/MiniAppLayout";
import { useAppFeatureFlags } from "../../providers/feature-flags/AppFeatureFlagsProvider";

export function SystemMonitorFeatureFlags() {
  const { passkeysEnabled, setPasskeysEnabled } = useAppFeatureFlags();
  const passkeysToggleId = useId();

  return (
    <MiniAppSection className="system-monitor-feature-flags">
      <MiniAppSectionHeading>
        <h2>Feature Flags</h2>
      </MiniAppSectionHeading>
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
    </MiniAppSection>
  );
}
