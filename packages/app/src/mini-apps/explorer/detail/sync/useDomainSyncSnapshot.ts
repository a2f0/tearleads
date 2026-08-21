import type { DomainScope, DomainSyncSnapshot } from "@symcrypt/client-sdk";
import {
  getDomainSyncCoordinatorSnapshot,
  subscribeToDomainSyncCoordinator,
} from "@symcrypt/client-sdk";
import { useCallback } from "react";
import { useSymCryptExternalValue } from "../../../../providers/sdk/useSymCryptSubscription";

export function useDomainSyncSnapshot(
  domainScope: DomainScope,
): DomainSyncSnapshot {
  const subscribe = useCallback(
    (listener: () => void) =>
      subscribeToDomainSyncCoordinator(domainScope, listener),
    [domainScope],
  );
  const getSnapshot = useCallback(
    () => getDomainSyncCoordinatorSnapshot(domainScope),
    [domainScope],
  );

  return useSymCryptExternalValue(subscribe, getSnapshot);
}
