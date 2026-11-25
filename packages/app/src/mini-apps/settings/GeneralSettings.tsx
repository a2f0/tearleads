import { useSuppressWindowToolbar } from "@tearleads/windowing";
import { TelemetryConsentSwitch } from "../../components/shared/TelemetryConsentSwitch";

export function GeneralSettings() {
  useSuppressWindowToolbar(true);

  return (
    <fieldset className="app-settings-group">
      <legend>Privacy</legend>
      <TelemetryConsentSwitch showDescription />
    </fieldset>
  );
}
