import { useId } from "react";
import {
  MiniAppCheckbox,
  MiniAppSection,
  MiniAppSectionHeading,
} from "../../../components/mini-app/MiniAppLayout";
import { useAppFeatureFlags } from "../../../providers/feature-flags/AppFeatureFlagsProvider";
import { APP_FEATURE_FLAG_IDS } from "../../../providers/feature-flags/appFeatureFlags";
import {
  FEATURE_FLAG_DETAILS,
  formatFeatureFlagState,
} from "./useSystemMonitorFeatureFlagRows";

// One flag's row: the label, its current state as text, and the switch. Every
// flag renders identically, so the row owns its own `useId` rather than making
// the panel below thread one per flag. The label is phrased as the action the
// switch performs, so it doubles as the switch's accessible name.
function SystemMonitorFeatureFlagToggle({
  enabled,
  label,
  onChange,
}: {
  enabled: boolean;
  label: string;
  onChange: (enabled: boolean) => void;
}) {
  const toggleId = useId();

  return (
    <label className="system-monitor-feature-flag" htmlFor={toggleId}>
      <span className="system-monitor-feature-flag-name">{label}</span>
      <span className="system-monitor-feature-flag-control">
        <span className="system-monitor-feature-flag-state">
          {formatFeatureFlagState(enabled)}
        </span>
        <MiniAppCheckbox
          aria-checked={enabled}
          aria-label={label}
          checked={enabled}
          id={toggleId}
          role="switch"
          onChange={(event) => {
            onChange(event.currentTarget.checked);
          }}
        />
      </span>
    </label>
  );
}

export function SystemMonitorFeatureFlags() {
  const { isEnabled, setEnabled } = useAppFeatureFlags();

  return (
    <MiniAppSection className="system-monitor-feature-flags">
      <MiniAppSectionHeading>
        <h2>Feature Flags</h2>
      </MiniAppSectionHeading>
      {APP_FEATURE_FLAG_IDS.map((flag) => (
        <SystemMonitorFeatureFlagToggle
          key={flag}
          enabled={isEnabled(flag)}
          label={FEATURE_FLAG_DETAILS[flag].label}
          onChange={(enabled) => {
            setEnabled(flag, enabled);
          }}
        />
      ))}
    </MiniAppSection>
  );
}
