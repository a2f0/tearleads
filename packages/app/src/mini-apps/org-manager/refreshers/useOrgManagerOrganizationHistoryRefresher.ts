import type { OrganizationPolicyHistory } from "@tearleads/client-sdk";
import { type Dispatch, type SetStateAction, useCallback, useRef } from "react";
import type { useOrgManagerActions } from "../../../stores/org-manager/OrgManagerProvider";
import type { useOrgManagerRequestGuard } from "../hooks/useOrgManagerRequestGuard";
import {
  appendOrganizationPolicyHistoryPage,
  assertOrganizationPolicyHistoryPage,
} from "../policy-history/organizationPolicyHistoryPages";
import { runScopedRefresher, setUnknownError } from "../refresh";

export function useOrgManagerOrganizationHistoryRefresher(input: {
  beginRequest: ReturnType<typeof useOrgManagerRequestGuard>;
  orgManagerActions: ReturnType<typeof useOrgManagerActions>;
  history: OrganizationPolicyHistory | null;
  setError: Dispatch<SetStateAction<string | null>>;
  setOrganizationPolicyHistory: Dispatch<
    SetStateAction<OrganizationPolicyHistory | null>
  >;
}) {
  const {
    beginRequest,
    orgManagerActions,
    history,
    setError,
    setOrganizationPolicyHistory,
  } = input;
  const historyError = useRef<string | null>(null);
  return useCallback(() => {
    const beforeVersion = history?.nextBeforeVersion;
    if (!history || beforeVersion == null) return Promise.resolve();
    return runScopedRefresher({
      beginRequest,
      requestKind: "organizationHistoryPage",
      options: { clearError: false },
      setError,
      load: async () => {
        const page = await orgManagerActions.loadPolicyHistory(beforeVersion);
        assertOrganizationPolicyHistoryPage(
          page,
          history.organizationId,
          beforeVersion,
        );
        return page;
      },
      apply: (page) => {
        setOrganizationPolicyHistory((previous) =>
          appendOrganizationPolicyHistoryPage(previous, page, beforeVersion),
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
    });
  }, [
    beginRequest,
    orgManagerActions,
    history,
    setError,
    setOrganizationPolicyHistory,
  ]);
}
