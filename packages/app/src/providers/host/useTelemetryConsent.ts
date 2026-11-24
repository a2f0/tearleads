import { useTearleadsExternalValue } from "../sdk/useTearleadsSubscription";
import { useAppHostConfig } from "./AppHostConfigProvider";

/** The device's anonymous-telemetry choice, live across tabs. */
export function useTelemetryConsent(): {
  readonly enabled: boolean;
  readonly setEnabled: (enabled: boolean) => void;
} {
  const { telemetryConsent } = useAppHostConfig();
  const enabled = useTearleadsExternalValue(
    telemetryConsent.subscribe,
    telemetryConsent.enabled,
  );
  return { enabled, setEnabled: telemetryConsent.setEnabled };
}
