import { MonitorIcon } from "@phosphor-icons/react/dist/csr/Monitor";
import {
  LaserScreensaver,
  MenuItem,
  ScreensaverProvider,
  useScreensaver,
} from "@tearleads/windowing";
import { createContext, type PropsWithChildren, useContext } from "react";
import { useLocalKeyringLock } from "../../providers/local-keyring/LocalKeyringLockProvider";

const AppScreensaverContext = createContext(false);

// One host inside the shared runtime, above all workspace/window state. The
// isolated demo deliberately has no host: its peers have independent PINs.
export function AppScreensaverHost({ children }: PropsWithChildren) {
  const { pinCodeEnabled, verifyPinCode } = useLocalKeyringLock();

  return (
    <ScreensaverProvider
      screensaver={LaserScreensaver}
      verifyPin={pinCodeEnabled ? verifyPinCode : undefined}
    >
      <AppScreensaverContext.Provider value={true}>
        {children}
      </AppScreensaverContext.Provider>
    </ScreensaverProvider>
  );
}

function StartScreensaver({ onClose }: { onClose?: (() => void) | undefined }) {
  const { start } = useScreensaver();
  const launch = () => {
    onClose?.();
    start();
  };

  return onClose ? (
    <MenuItem icon={MonitorIcon} label="Start Screensaver" onClick={launch} />
  ) : (
    <button
      aria-label="Start Screensaver"
      className="tearleads-action-button"
      onClick={launch}
      title="Start Screensaver"
      type="button"
    >
      <MonitorIcon aria-hidden="true" />
    </button>
  );
}

export function AppScreensaverAction({
  onClose,
}: {
  onClose?: (() => void) | undefined;
}) {
  const available = useContext(AppScreensaverContext);
  return available ? <StartScreensaver onClose={onClose} /> : null;
}
