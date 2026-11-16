import { MonitorIcon } from "@phosphor-icons/react/dist/csr/Monitor";
import {
  LaserScreensaver,
  MenuItem,
  ScreensaverProvider,
  useOptionalScreensaver,
} from "@tearleads/windowing";
import type { PropsWithChildren } from "react";
import { useLocalKeyringLock } from "../../providers/local-keyring/LocalKeyringLockProvider";

// One host inside the shared runtime, above all workspace/window state. The
// isolated demo deliberately has no host: its peers have independent PINs, so
// the desktop menu item and the Screensaver Button tray app hide there.
export function AppScreensaverHost({ children }: PropsWithChildren) {
  const { pinCodeEnabled, verifyPinCode } = useLocalKeyringLock();

  return (
    <ScreensaverProvider
      screensaver={LaserScreensaver}
      verifyPin={pinCodeEnabled ? verifyPinCode : undefined}
    >
      {children}
    </ScreensaverProvider>
  );
}

/** The desktop menu's Start Screensaver item; nothing without a host. */
export function AppScreensaverMenuItem({ onClose }: { onClose: () => void }) {
  const screensaver = useOptionalScreensaver();
  if (!screensaver) {
    return null;
  }

  return (
    <MenuItem
      icon={MonitorIcon}
      label="Start Screensaver"
      onClick={() => {
        onClose();
        screensaver.start();
      }}
    />
  );
}
