import { useCallback } from "react";

import { useDatabase } from "../../../providers/db/DatabaseProvider";
import { useLocalKeyringLock } from "../../../providers/local-keyring/LocalKeyringLockProvider";
import { useTearleads } from "../../../providers/sdk/TearleadsProvider";

export function usePaneLockMenuAction(onClose: () => void) {
  const { clearWorker } = useDatabase();
  const localKeyringLock = useLocalKeyringLock();
  const tearleads = useTearleads();
  const canLockPane =
    localKeyringLock.pinCodeEnabled && !localKeyringLock.isLocked;

  const lockPane = useCallback(async () => {
    if (!canLockPane || !localKeyringLock.lock()) {
      onClose();
      return;
    }

    tearleads.session.setContext({
      authToken: null,
      containerId: null,
      defaultOrganizationId: null,
      isAuthenticated: false,
      organizationId: null,
      userId: null,
    });
    try {
      await tearleads.identity.setKeyPairs({
        encapsulationKeyPair: null,
        signingKeyPair: null,
      });
    } catch (error: unknown) {
      tearleads.logError("Failed to clear identity keys while locking", error);
    }
    clearWorker();
    onClose();
  }, [canLockPane, clearWorker, localKeyringLock, onClose, tearleads]);

  return { canLockPane, lockPane };
}
