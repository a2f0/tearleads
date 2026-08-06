import type { PaneLogEntry } from "../../../components/pane/log/PaneLog";
import { useBootPaneLogEntries } from "../../../components/pane/log/useBootPaneLogEntries";
import { useIdentity } from "../../../providers/identity/IdentityProvider";
import { useLocalKeyringLock } from "../../../providers/local-keyring/LocalKeyringLockProvider";
import { useLog } from "../../../providers/logging/LogProvider";

const BOOT_PANE_LOG_MESSAGE =
  "Generate a key pair from the pane menu to boot this pane.";

/**
 * The synthetic trailing entries the Logs tab appends after the real log — the
 * boot hint shown when the pane has no key pair yet.
 */
export function useSystemMonitorBootLogEntries(): ReadonlyArray<PaneLogEntry> {
  const { signingKeyPair } = useIdentity();
  const localKeyringLock = useLocalKeyringLock();
  const hasSigningKeyPair = signingKeyPair !== null;

  return useBootPaneLogEntries({
    bootMessage: BOOT_PANE_LOG_MESSAGE,
    hasSigningKeyPair,
    paneLocked: localKeyringLock.isLocked && !hasSigningKeyPair,
  });
}

/**
 * The Logs tab's contents as plain data: everything PaneLog renders, in render
 * order.
 *
 * PaneLog does this concatenation internally for display. The support report
 * needs the same list without the tab being mounted, so it reads this rather
 * than re-deriving which trailing entries the tab would have appended.
 */
export function useSystemMonitorLogEntries(): ReadonlyArray<PaneLogEntry> {
  const { entries } = useLog();
  const bootEntries = useSystemMonitorBootLogEntries();

  return [...entries, ...bootEntries];
}
