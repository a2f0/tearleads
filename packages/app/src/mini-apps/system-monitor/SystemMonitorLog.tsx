import { useBootPaneLogEntries } from "../../components/pane/log/useBootPaneLogEntries";
import { PaneLog } from "../../components/pane/PaneLog";
import { useIdentity } from "../../providers/identity/IdentityProvider";
import { useLocalKeyringLock } from "../../providers/local-keyring/LocalKeyringLockProvider";

const BOOT_PANE_LOG_MESSAGE =
  "Generate a key pair from the pane menu to boot this pane.";

export function SystemMonitorLog() {
  const { signingKeyPair } = useIdentity();
  const localKeyringLock = useLocalKeyringLock();
  const hasSigningKeyPair = signingKeyPair !== null;
  const paneLocked = localKeyringLock.isLocked && !hasSigningKeyPair;
  const trailingEntries = useBootPaneLogEntries({
    bootMessage: BOOT_PANE_LOG_MESSAGE,
    hasSigningKeyPair,
    paneLocked,
  });

  return <PaneLog trailingEntries={trailingEntries} />;
}
