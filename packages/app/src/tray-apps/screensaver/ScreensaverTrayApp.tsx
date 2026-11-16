import { MonitorIcon } from "@phosphor-icons/react/dist/csr/Monitor";
import { useOptionalScreensaver } from "@tearleads/windowing";

const START_SCREENSAVER_LABEL = "Start Screensaver";

/**
 * The Screensaver Button tray app. It starts the shared screensaver the app
 * shell hosts, and renders nothing where no host is mounted (the isolated
 * demo, whose peers have independent PINs).
 */
export function ScreensaverTrayApp() {
  const screensaver = useOptionalScreensaver();
  if (!screensaver) {
    return null;
  }

  return (
    <button
      aria-label={START_SCREENSAVER_LABEL}
      className="tearleads-action-button"
      onClick={screensaver.start}
      title={START_SCREENSAVER_LABEL}
      type="button"
    >
      <MonitorIcon aria-hidden="true" />
    </button>
  );
}
