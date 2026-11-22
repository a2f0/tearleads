import type {
  DomainDownloadHistorySnapshot,
  DomainScope,
} from "@tearleads/client-sdk";
import {
  getDomainDownloadHistorySnapshot,
  subscribeToDomainDownloadHistory,
} from "@tearleads/client-sdk";
import { useCallback } from "react";
import { useTearleadsExternalValue } from "./useTearleadsSubscription";

/** The downloads the SDK recorded finishing in this scope, newest first. */
export function useDomainDownloadHistory(
  domainScope: DomainScope,
): DomainDownloadHistorySnapshot {
  const subscribe = useCallback(
    (listener: () => void) =>
      subscribeToDomainDownloadHistory(domainScope, listener),
    [domainScope],
  );
  const getSnapshot = useCallback(
    () => getDomainDownloadHistorySnapshot(domainScope),
    [domainScope],
  );
  return useTearleadsExternalValue(subscribe, getSnapshot);
}
