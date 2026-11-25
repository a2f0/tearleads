import { useId } from "react";
import { useTelemetryConsent } from "../../providers/host/useTelemetryConsent";
import { MiniAppCheckbox } from "../mini-app/MiniAppLayout";
import "./TelemetryConsentSwitch.css";

/**
 * The opt-in to anonymous telemetry, shown during onboarding and in Settings >
 * General. Off until the user turns it on; either place changes the one
 * device-wide choice the shell's collectors follow. Onboarding shows the bare
 * switch; Settings adds what the choice sends with `showDescription`.
 */
export function TelemetryConsentSwitch({
  showDescription = false,
}: {
  showDescription?: boolean;
}) {
  const { enabled, setEnabled } = useTelemetryConsent();
  const switchId = useId();
  const descriptionId = useId();

  return (
    <div className="telemetry-consent">
      <label className="telemetry-consent-toggle" htmlFor={switchId}>
        <MiniAppCheckbox
          aria-checked={enabled}
          aria-describedby={showDescription ? descriptionId : undefined}
          checked={enabled}
          id={switchId}
          onChange={(event) => setEnabled(event.currentTarget.checked)}
          role="switch"
        />
        Share anonymous telemetry
      </label>
      {showDescription ? (
        <p className="telemetry-consent-description" id={descriptionId}>
          Sends error reports and interface usage to help improve Tearleads.
          They never include your content, names, or account identifiers. The
          services that receive them can see your IP address.
        </p>
      ) : null}
    </div>
  );
}
