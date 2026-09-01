import type { OrganizationDataUsage } from "@tearleads/client-sdk";
import type { Dispatch, SetStateAction } from "react";
import { useCallback } from "react";
import type { useTearleadsRuntime } from "../../../providers/sdk/TearleadsProvider";
import type { useOrgManagerActions } from "../../../stores/org-manager/OrgManagerProvider";
import { resolveDataUsageRefresh } from "../billing/dataUsageRefreshState";
import type { useOrgManagerRequestGuard } from "../hooks/useOrgManagerRequestGuard";
import { ORG_MANAGER_LABELS } from "../labels";
import {
  type DataUsageRefreshOptions,
  runScopedRefresher,
  setUnknownError,
} from "../refresh";

interface OrgManagerDataUsageRefresherInput {
  readonly appData: ReturnType<typeof useTearleadsRuntime>;
  readonly beginRequest: ReturnType<typeof useOrgManagerRequestGuard>;
  readonly canLoadAuthenticatedOrgData: boolean;
  readonly dataUsageRef: { current: OrganizationDataUsage | null };
  readonly orgManagerActions: ReturnType<typeof useOrgManagerActions>;
  readonly setDataUsage: Dispatch<SetStateAction<OrganizationDataUsage | null>>;
  readonly setError: Dispatch<SetStateAction<string | null>>;
  // Usage refreshes on view entry run with `manageLoading: false`, so `loading`
  // never covers them; this mark is how the view learns the fetch happened.
  readonly markDataUsageSettled: () => void;
  readonly setLoading: Dispatch<SetStateAction<boolean>>;
}

/**
 * Records that usage has been looked at — but not for an empty `localOnly` pass.
 *
 * Entering the usage view paints the local cache first and then reconciles.
 * Settling on a local pass that found nothing would report "hasn't synced yet"
 * while the real request is still in flight; settling on one that found
 * something is correct, since there is data on screen either way.
 */
function settleDataUsageIfAnswered(input: {
  readonly hasUsage: boolean;
  readonly localOnly: boolean;
  readonly markDataUsageSettled: () => void;
}): void {
  if (!input.localOnly || input.hasUsage) {
    input.markDataUsageSettled();
  }
}

export function useOrgManagerDataUsageRefresher(
  input: OrgManagerDataUsageRefresherInput,
) {
  const {
    beginRequest,
    canLoadAuthenticatedOrgData,
    dataUsageRef,
    orgManagerActions,
    setDataUsage,
    setError,
    markDataUsageSettled,
    setLoading,
  } = input;
  const organizationId = input.appData.auth.organizationId;
  return useCallback(
    (options: DataUsageRefreshOptions = {}) =>
      runScopedRefresher({
        apply: (nextUsage) => {
          if (!organizationId) {
            dataUsageRef.current = null;
            setDataUsage(null);
            return;
          }
          const resolution = resolveDataUsageRefresh({
            current: dataUsageRef.current,
            localOnly: options.localOnly ?? false,
            next: nextUsage,
            organizationId,
          });
          dataUsageRef.current = resolution.value;
          setDataUsage(resolution.value);
          if (resolution.shouldReportMissing) {
            setError(ORG_MANAGER_LABELS.failedLoadDataUsage);
          }
        },
        beginRequest,
        load: canLoadAuthenticatedOrgData
          ? () =>
              options.localOnly
                ? orgManagerActions.loadLocalDataUsage()
                : orgManagerActions.loadDataUsage()
          : null,
        onError: (error) => setUnknownError(setError, error),
        onSettled: () =>
          settleDataUsageIfAnswered({
            hasUsage: dataUsageRef.current !== null,
            localOnly: options.localOnly ?? false,
            markDataUsageSettled,
          }),
        onUnavailable: () => {
          dataUsageRef.current = null;
          setDataUsage(null);
        },
        options,
        requestKind: "dataUsage",
        setError,
        setLoading,
      }),
    [
      beginRequest,
      canLoadAuthenticatedOrgData,
      dataUsageRef,
      markDataUsageSettled,
      organizationId,
      orgManagerActions,
      setDataUsage,
      setError,
      setLoading,
    ],
  );
}
