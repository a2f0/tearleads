import type { OrganizationUserDetail } from "@tearleads/client-sdk";
import type { Dispatch, SetStateAction } from "react";
import { useCallback } from "react";
import type { useOrgManagerActions } from "../../../stores/org-manager/OrgManagerProvider";
import { ORG_MANAGER_LABELS } from "../labels";
import { type GroupDetailsRefreshOptions, setUnknownError } from "../refresh";
import type { useOrgManagerRequestGuard } from "./useOrgManagerRequestGuard";

export function useOrgManagerUserDetailRefresher(input: {
  beginRequest: ReturnType<typeof useOrgManagerRequestGuard>;
  canLoadAuthenticatedOrgData: boolean;
  orgManagerActions: ReturnType<typeof useOrgManagerActions>;
  setError: Dispatch<SetStateAction<string | null>>;
  setLoadingUserDetail: Dispatch<SetStateAction<boolean>>;
  setUserDetail: Dispatch<SetStateAction<OrganizationUserDetail | null>>;
}) {
  const {
    beginRequest,
    canLoadAuthenticatedOrgData,
    orgManagerActions,
    setError,
    setLoadingUserDetail,
    setUserDetail,
  } = input;
  return useCallback(
    async (userId: string | null, options: GroupDetailsRefreshOptions = {}) => {
      const isCurrentRequest = beginRequest("userDetail");
      if (!canLoadAuthenticatedOrgData || !userId) {
        setUserDetail(null);
        setLoadingUserDetail(false);
        return;
      }

      setLoadingUserDetail(true);
      if (options.clearError ?? true) {
        setError(null);
      }
      try {
        const nextDetail = await orgManagerActions.loadUserDetail(userId);
        if (!isCurrentRequest()) {
          return;
        }
        if (nextDetail === null) {
          setUserDetail(null);
          setError(ORG_MANAGER_LABELS.failedLoadUserDetail);
          return;
        }
        setUserDetail(nextDetail);
      } catch (error) {
        if (isCurrentRequest()) {
          setUserDetail(null);
          setUnknownError(setError, error);
        }
      } finally {
        if (isCurrentRequest()) {
          setLoadingUserDetail(false);
        }
      }
    },
    [
      beginRequest,
      canLoadAuthenticatedOrgData,
      orgManagerActions,
      setError,
      setLoadingUserDetail,
      setUserDetail,
    ],
  );
}
