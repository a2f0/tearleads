import type { OrganizationGroupContainers } from "@tearleads/client-sdk";
import type { Dispatch, SetStateAction } from "react";
import { useCallback } from "react";
import type { useOrgManagerActions } from "../../../stores/org-manager/OrgManagerProvider";
import type { useOrgManagerRequestGuard } from "../hooks/useOrgManagerRequestGuard";
import { ORG_MANAGER_LABELS } from "../labels";
import { setUnknownError } from "../refresh";

export function useOrgManagerGroupContainersRefresher(input: {
  beginRequest: ReturnType<typeof useOrgManagerRequestGuard>;
  canLoadAuthenticatedOrgData: boolean;
  orgManagerActions: ReturnType<typeof useOrgManagerActions>;
  setError: Dispatch<SetStateAction<string | null>>;
  setGroupContainers: Dispatch<
    SetStateAction<OrganizationGroupContainers | null>
  >;
}) {
  const {
    beginRequest,
    canLoadAuthenticatedOrgData,
    orgManagerActions,
    setError,
    setGroupContainers,
  } = input;
  return useCallback(
    async (groupId: string | null) => {
      const isCurrentRequest = beginRequest("groupContainers");
      if (!canLoadAuthenticatedOrgData || !groupId) {
        setGroupContainers(null);
        return;
      }

      try {
        const containers = await orgManagerActions.loadGroupContainers(groupId);
        if (!isCurrentRequest()) {
          return;
        }
        setGroupContainers(containers);
        if (containers === null) {
          setError(ORG_MANAGER_LABELS.failedLoadGroupContainers);
        }
      } catch (error) {
        if (isCurrentRequest()) {
          setGroupContainers(null);
          setUnknownError(setError, error);
        }
      }
    },
    [
      beginRequest,
      canLoadAuthenticatedOrgData,
      orgManagerActions,
      setError,
      setGroupContainers,
    ],
  );
}
