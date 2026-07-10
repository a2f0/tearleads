import type { DomainScope, DomainSyncSnapshot } from "@tearleads/client-sdk";
import {
  getDomainSyncCoordinatorSnapshot,
  subscribeToDomainSyncCoordinator,
} from "@tearleads/client-sdk";
import { useCallback } from "react";
import { useTearleadsExternalValue } from "../../../../providers/sdk/useTearleadsSubscription";

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

  return useTearleadsExternalValue(subscribe, getSnapshot);
}
