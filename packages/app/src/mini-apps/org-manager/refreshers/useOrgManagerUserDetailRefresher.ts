import type { OrganizationUserDetail } from "@tearleads/client-sdk";
import type { Dispatch, SetStateAction } from "react";
import { useCallback } from "react";
import type { useOrgManagerActions } from "../../../stores/org-manager/OrgManagerProvider";
import type { useOrgManagerRequestGuard } from "../hooks/useOrgManagerRequestGuard";
import { ORG_MANAGER_LABELS } from "../labels";
import {
  type GroupDetailsRefreshOptions,
  runScopedRefresher,
  setUnknownError,
} from "../refresh";

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
    (userId: string | null, options: GroupDetailsRefreshOptions = {}) =>
      runScopedRefresher({
        apply: (nextDetail) => {
          if (nextDetail === null) {
            setUserDetail(null);
            setError(ORG_MANAGER_LABELS.failedLoadUserDetail);
            return;
          }
          setUserDetail(nextDetail);
        },
        beginRequest,
        load:
          canLoadAuthenticatedOrgData && userId
            ? () => orgManagerActions.loadUserDetail(userId)
            : null,
        onError: (error) => {
          setUserDetail(null);
          setUnknownError(setError, error);
        },
        onUnavailable: () => {
          setUserDetail(null);
          setLoadingUserDetail(false);
        },
        options,
        requestKind: "userDetail",
        setError,
        setLoading: setLoadingUserDetail,
      }),
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
