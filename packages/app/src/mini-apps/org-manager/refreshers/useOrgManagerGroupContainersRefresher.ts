import type { OrganizationGroupContainers } from "@tearleads/client-sdk";
import type { Dispatch, SetStateAction } from "react";
import { useCallback } from "react";
import type { useOrgManagerActions } from "../../../stores/org-manager/OrgManagerProvider";
import type { useOrgManagerRequestGuard } from "../hooks/useOrgManagerRequestGuard";
import { ORG_MANAGER_LABELS } from "../labels";
import { runScopedRefresher, setUnknownError } from "../refresh";

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
    (groupId: string | null) =>
      runScopedRefresher({
        apply: (containers) => {
          setGroupContainers(containers);
          if (containers === null) {
            setError(ORG_MANAGER_LABELS.failedLoadGroupContainers);
          }
        },
        beginRequest,
        load:
          canLoadAuthenticatedOrgData && groupId
            ? () => orgManagerActions.loadGroupContainers(groupId)
            : null,
        onError: (error) => {
          setGroupContainers(null);
          setUnknownError(setError, error);
        },
        onUnavailable: () => setGroupContainers(null),
        options: { clearError: false, manageLoading: false },
        requestKind: "groupContainers",
        setError,
      }),
    [
      beginRequest,
      canLoadAuthenticatedOrgData,
      orgManagerActions,
      setError,
      setGroupContainers,
    ],
  );
}
