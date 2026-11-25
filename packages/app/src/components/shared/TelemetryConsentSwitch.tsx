import { useId } from "react";
import { useTelemetryConsent } from "../../providers/host/useTelemetryConsent";
import { MiniAppCheckbox } from "../mini-app/MiniAppLayout";
import "./TelemetryConsentSwitch.css";

/**
 * The opt-in to anonymous telemetry, shown during onboarding and in Settings >
 * General. Off until the user turns it on; either place changes the one
 * device-wide choice the shell's collectors follow.
 */
export function TelemetryConsentSwitch() {
  const { enabled, setEnabled } = useTelemetryConsent();
  const switchId = useId();

  return (
    <div className="telemetry-consent">
      <label className="telemetry-consent-toggle" htmlFor={switchId}>
        <MiniAppCheckbox
          aria-checked={enabled}
          checked={enabled}
          id={switchId}
          onChange={(event) => setEnabled(event.currentTarget.checked)}
          role="switch"
        />
        Share anonymous telemetry
      </label>
    </div>
  );
}
