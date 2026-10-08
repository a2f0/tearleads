import type { OrganizationGroupPolicyHistory } from "@tearleads/client-sdk";
import type { Dispatch, SetStateAction } from "react";
import { useCallback, useRef } from "react";
import type { useTearleadsRuntime } from "../../../providers/sdk/TearleadsProvider";
import type { useOrgManagerActions } from "../../../stores/org-manager/OrgManagerProvider";
import type { useOrgManagerRequestGuard } from "../hooks/useOrgManagerRequestGuard";
import {
  appendGroupPolicyHistoryPage,
  assertGroupPolicyHistoryPage,
} from "../policy-history/groupPolicyHistoryPages";
import { runScopedRefresher, setUnknownError } from "../refresh";

/** Older rows never update members or settle the selected group's full refresh. */
export function useOrgManagerGroupHistoryRefresher(input: {
  appData: ReturnType<typeof useTearleadsRuntime>;
  beginRequest: ReturnType<typeof useOrgManagerRequestGuard>;
  orgManagerActions: ReturnType<typeof useOrgManagerActions>;
  setError: Dispatch<SetStateAction<string | null>>;
  setGroupPolicyHistory: Dispatch<
    SetStateAction<OrganizationGroupPolicyHistory | null>
  >;
}) {
  const {
    appData,
    beginRequest,
    orgManagerActions,
    setError,
    setGroupPolicyHistory,
  } = input;
  const organizationId = appData.auth.organizationId;
  const historyError = useRef<string | null>(null);
  return useCallback(
    (groupId: string | null, beforeVersion: number) =>
      runScopedRefresher({
        beginRequest,
        requestKind: "groupHistoryPage",
        options: { clearError: false },
        setError,
        load:
          organizationId && groupId && appData.auth.isAuthenticated
            ? async () => {
                const details =
                  await orgManagerActions.loadGroupPresentationDetails(
                    groupId,
                    beforeVersion,
                  );
                assertGroupPolicyHistoryPage(details.policyHistory, {
                  groupId,
                  organizationId,
                  beforeVersion,
                });
                return details.policyHistory;
              }
            : null,
        apply: (page) => {
          setGroupPolicyHistory((previous) =>
            appendGroupPolicyHistoryPage(previous, page, beforeVersion),
          );
          const previousError = historyError.current;
          historyError.current = null;
          if (previousError !== null)
            setError((current) => (current === previousError ? null : current));
        },
        onError: (error) =>
          setUnknownError((message) => {
            historyError.current = message;
            setError(message);
          }, error),
      }),
    [
      appData.auth.isAuthenticated,
      organizationId,
      beginRequest,
      orgManagerActions,
      setError,
      setGroupPolicyHistory,
    ],
  );
}
