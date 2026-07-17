import type { Dispatch, SetStateAction } from "react";
import { useCallback } from "react";
import type { useOrgManagerRequestGuard } from "../hooks/useOrgManagerRequestGuard";
import {
  type OrgManagerVisibleRefreshInput,
  refreshOrgManagerVisibleData,
} from "../refresh";

interface OrgManagerVisibleRefresherInput
  extends Omit<OrgManagerVisibleRefreshInput, "getSelectedUserId"> {
  beginRequest: ReturnType<typeof useOrgManagerRequestGuard>;
  selectedUserIdRef: { current: string | null };
  setError: Dispatch<SetStateAction<string | null>>;
  setLoading: Dispatch<SetStateAction<boolean>>;
}

export function useOrgManagerVisibleRefresher(
  input: OrgManagerVisibleRefresherInput,
): () => Promise<void> {
  const {
    beginRequest,
    refreshDataUsage,
    refreshDirectoryAndGroups,
    refreshGrants,
    refreshOrganizationPolicyHistory,
    refreshSelectedGroupContainers,
    refreshSelectedGroupDetails,
    refreshSelectedUserDetail,
    selectedUserIdRef,
    setError,
    setLoading,
    view,
  } = input;

  return useCallback(async () => {
    const isCurrentRequest = beginRequest("refresh");
    setLoading(true);
    setError(null);
    try {
      await refreshOrgManagerVisibleData({
        getSelectedUserId: () => selectedUserIdRef.current,
        refreshDataUsage,
        refreshDirectoryAndGroups,
        refreshGrants,
        refreshOrganizationPolicyHistory,
        refreshSelectedGroupContainers,
        refreshSelectedGroupDetails,
        refreshSelectedUserDetail,
        view,
      });
    } finally {
      if (isCurrentRequest()) {
        setLoading(false);
      }
    }
  }, [
    beginRequest,
    refreshDataUsage,
    refreshDirectoryAndGroups,
    refreshGrants,
    refreshOrganizationPolicyHistory,
    refreshSelectedGroupContainers,
    refreshSelectedGroupDetails,
    refreshSelectedUserDetail,
    selectedUserIdRef,
    setError,
    setLoading,
    view,
  ]);
}
