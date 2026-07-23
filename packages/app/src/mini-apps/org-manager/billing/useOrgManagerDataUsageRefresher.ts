import type { OrganizationDataUsage } from "@tearleads/client-sdk";
import type { Dispatch, SetStateAction } from "react";
import { useCallback } from "react";
import type { useTearleadsRuntime } from "../../../providers/sdk/TearleadsProvider";
import type { useOrgManagerActions } from "../../../stores/org-manager/OrgManagerProvider";
import type { useOrgManagerRequestGuard } from "../hooks/useOrgManagerRequestGuard";
import { ORG_MANAGER_LABELS } from "../labels";
import {
  clearErrorIfRequested,
  type DataUsageRefreshOptions,
  getRefreshBehavior,
  setLoadingIfManaged,
  setUnknownError,
} from "../refresh";
import { resolveDataUsageRefresh } from "./dataUsageRefreshState";

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
    async (options: DataUsageRefreshOptions = {}) => {
      const isCurrentRequest = beginRequest("dataUsage");
      const { shouldClearError, shouldManageLoading } =
        getRefreshBehavior(options);
      if (!canLoadAuthenticatedOrgData) {
        dataUsageRef.current = null;
        setDataUsage(null);
        return;
      }

      setLoadingIfManaged(shouldManageLoading, setLoading, true);
      clearErrorIfRequested(shouldClearError, setError);

      try {
        const nextUsage = options.localOnly
          ? await orgManagerActions.loadLocalDataUsage()
          : await orgManagerActions.loadDataUsage();
        if (!isCurrentRequest()) {
          return;
        }
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
      } catch (error) {
        if (isCurrentRequest()) {
          setUnknownError(setError, error);
        }
      } finally {
        if (isCurrentRequest()) {
          setLoadingIfManaged(shouldManageLoading, setLoading, false);
          markDataUsageSettled();
        }
      }
    },
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
