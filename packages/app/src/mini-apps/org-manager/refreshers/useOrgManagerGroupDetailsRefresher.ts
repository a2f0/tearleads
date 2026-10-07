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
  appendGroupPolicyHistoryPage,
  assertGroupPolicyHistoryPage,
} from "../policy-history/groupPolicyHistoryPages";
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
  const organizationId = appData.auth.organizationId;
  return useCallback(
    (groupId: string | null, options: GroupDetailsRefreshOptions = {}) =>
      runScopedRefresher({
        apply: (details) => {
          const errors: string[] = [];
          if (options.beforeVersion === undefined) {
            if (details.members === null) {
              setMembers(null);
              errors.push(ORG_MANAGER_LABELS.failedLoadGroupMembers);
            } else {
              setMembers(details.members);
            }
            setGroupPolicyHistory(details.policyHistory);
          } else {
            const beforeVersion = options.beforeVersion;
            setGroupPolicyHistory((previous) =>
              appendGroupPolicyHistoryPage(
                previous,
                details.policyHistory,
                beforeVersion,
              ),
            );
          }
          if (errors.length > 0) {
            setError(errors.join(" "));
          }
        },
        beginRequest,
        load:
          organizationId && groupId && appData.auth.isAuthenticated
            ? async () => {
                const details =
                  await orgManagerActions.loadGroupPresentationDetails(
                    groupId,
                    options.beforeVersion,
                  );
                if (options.beforeVersion !== undefined) {
                  assertGroupPolicyHistoryPage(details.policyHistory, {
                    groupId,
                    organizationId,
                    beforeVersion: options.beforeVersion,
                  });
                }
                return details;
              }
            : null,
        onError: (error) => {
          if (options.beforeVersion === undefined) {
            setMembers(null);
            setGroupPolicyHistory(null);
          }
          setUnknownError(setError, error);
        },
        onSettled: () => {
          if (options.beforeVersion === undefined)
            markGroupDetailsSettled(groupId);
        },
        onUnavailable: () => {
          if (options.beforeVersion === undefined) {
            setMembers(null);
            setGroupPolicyHistory(null);
          }
        },
        options,
        requestKind:
          options.beforeVersion === undefined
            ? "groupDetails"
            : "groupHistoryPage",
        setError,
      }),
    [
      appData.auth.isAuthenticated,
      organizationId,
      beginRequest,
      markGroupDetailsSettled,
      orgManagerActions,
      setError,
      setGroupPolicyHistory,
      setMembers,
    ],
  );
}
