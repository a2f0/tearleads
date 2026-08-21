import { useCallback } from "react";

import { useDatabase } from "../../../providers/db/DatabaseProvider";
import { useLocalKeyringLock } from "../../../providers/local-keyring/LocalKeyringLockProvider";
import { useSymCrypt } from "../../../providers/sdk/SymCryptProvider";

export function usePaneLockMenuAction(onClose: () => void) {
  const { clearWorker } = useDatabase();
  const localKeyringLock = useLocalKeyringLock();
  const symcrypt = useSymCrypt();
  const canLockPane =
    localKeyringLock.pinCodeEnabled && !localKeyringLock.isLocked;

  const lockPane = useCallback(async () => {
    if (!canLockPane || !localKeyringLock.lock()) {
      onClose();
      return;
    }

    symcrypt.session.setContext({
      authToken: null,
      containerId: null,
      defaultOrganizationId: null,
      isAuthenticated: false,
      organizationId: null,
      userId: null,
    });
    try {
      await symcrypt.identity.setKeyPairs({
        encapsulationKeyPair: null,
        signingKeyPair: null,
      });
    } catch (error: unknown) {
      symcrypt.logError("Failed to clear identity keys while locking", error);
    }
    clearWorker();
    onClose();
  }, [canLockPane, clearWorker, localKeyringLock, onClose, symcrypt]);

  return { canLockPane, lockPane };
}
