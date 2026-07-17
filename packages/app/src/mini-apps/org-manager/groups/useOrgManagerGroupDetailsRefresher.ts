import type {
  OrganizationGroupMembers,
  OrganizationGroupPolicyHistory,
} from "@tearleads/client-sdk";
import type { Dispatch, SetStateAction } from "react";
import { useCallback } from "react";
import type { useTearleadsRuntime } from "../../../providers/sdk/TearleadsProvider";
import type { useOrgManagerActions } from "../../../stores/org-manager/OrgManagerProvider";
import type { useOrgManagerRequestGuard } from "../hooks/useOrgManagerRequestGuard";
import { ORG_MANAGER_LABELS } from "../labels";
import type { GroupDetailsRefreshOptions } from "../refresh";
import { setUnknownError } from "../refresh";

export function useOrgManagerGroupDetailsRefresher(input: {
  appData: ReturnType<typeof useTearleadsRuntime>;
  beginRequest: ReturnType<typeof useOrgManagerRequestGuard>;
  orgManagerActions: ReturnType<typeof useOrgManagerActions>;
  setError: Dispatch<SetStateAction<string | null>>;
  setGroupPolicyHistory: Dispatch<
    SetStateAction<OrganizationGroupPolicyHistory | null>
  >;
  setMembers: Dispatch<SetStateAction<OrganizationGroupMembers | null>>;
}) {
  const {
    appData,
    beginRequest,
    orgManagerActions,
    setError,
    setGroupPolicyHistory,
    setMembers,
  } = input;
  return useCallback(
    async (
      groupId: string | null,
      options: GroupDetailsRefreshOptions = {},
    ) => {
      const isCurrentRequest = beginRequest("groupDetails");
      if (
        !appData.auth.organizationId ||
        !groupId ||
        !appData.auth.isAuthenticated
      ) {
        if (isCurrentRequest()) {
          setMembers(null);
          setGroupPolicyHistory(null);
        }
        return;
      }

      if (options.clearError ?? true) {
        setError(null);
      }
      try {
        const details =
          await orgManagerActions.loadGroupPresentationDetails(groupId);
        if (!isCurrentRequest()) {
          return;
        }
        const errors: string[] = [];
        if (details.members === null) {
          setMembers(null);
          errors.push(ORG_MANAGER_LABELS.failedLoadGroupMembers);
        } else {
          setMembers(details.members);
        }
        setGroupPolicyHistory(details.policyHistory);
        if (errors.length > 0) {
          setError(errors.join(" "));
        }
      } catch (error) {
        if (isCurrentRequest()) {
          setMembers(null);
          setGroupPolicyHistory(null);
          setUnknownError(setError, error);
        }
      }
    },
    [
      appData.auth.isAuthenticated,
      appData.auth.organizationId,
      beginRequest,
      orgManagerActions,
      setError,
      setGroupPolicyHistory,
      setMembers,
    ],
  );
}
