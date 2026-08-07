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
import {
  type GroupDetailsRefreshOptions,
  runScopedRefresher,
  setUnknownError,
} from "../refresh";

export function useOrgManagerGroupDetailsRefresher(input: {
  appData: ReturnType<typeof useTearleadsRuntime>;
  beginRequest: ReturnType<typeof useOrgManagerRequestGuard>;
  // These details carry no loading flag of their own, so the views learn that a
  // selected group has been fetched from this mark rather than from `loading`.
  markGroupDetailsSettled: (groupId: string | null) => void;
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
    markGroupDetailsSettled,
    orgManagerActions,
    setError,
    setGroupPolicyHistory,
    setMembers,
  } = input;
  return useCallback(
    (groupId: string | null, options: GroupDetailsRefreshOptions = {}) =>
      runScopedRefresher({
        apply: (details) => {
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
        },
        beginRequest,
        load:
          appData.auth.organizationId && groupId && appData.auth.isAuthenticated
            ? () => orgManagerActions.loadGroupPresentationDetails(groupId)
            : null,
        onError: (error) => {
          setMembers(null);
          setGroupPolicyHistory(null);
          setUnknownError(setError, error);
        },
        onSettled: () => markGroupDetailsSettled(groupId),
        onUnavailable: (isCurrentRequest) => {
          if (isCurrentRequest()) {
            setMembers(null);
            setGroupPolicyHistory(null);
          }
        },
        options,
        requestKind: "groupDetails",
        setError,
      }),
    [
      appData.auth.isAuthenticated,
      appData.auth.organizationId,
      beginRequest,
      markGroupDetailsSettled,
      orgManagerActions,
      setError,
      setGroupPolicyHistory,
      setMembers,
    ],
  );
}
