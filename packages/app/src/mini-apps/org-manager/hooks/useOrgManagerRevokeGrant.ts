import type {
  OrganizationContainerGrant,
  OrganizationContainerGrants,
  OrganizationGroupContainers,
  OrganizationUserDetail,
} from "@tearleads/client-sdk";
import type { Dispatch, SetStateAction } from "react";
import { useCallback } from "react";
import type { useOrgManagerActions } from "../../../stores/org-manager/OrgManagerProvider";
import {
  removeRevokedGrantFromGrantState,
  removeRevokedGrantFromGroupContainers,
  removeRevokedGrantFromUserDetail,
} from "../grants/grantState";
import { runScopedOrgMutation } from "./runScopedOrgMutation";

export function useOrgManagerRevokeGrant(input: {
  isOperationActive: (organizationId: string) => boolean;
  organizationId: string | null;
  orgManagerActions: ReturnType<typeof useOrgManagerActions>;
  setError: Dispatch<SetStateAction<string | null>>;
  setGrants: Dispatch<SetStateAction<OrganizationContainerGrants | null>>;
  setGroupContainers: Dispatch<
    SetStateAction<OrganizationGroupContainers | null>
  >;
  setMutating: Dispatch<SetStateAction<boolean>>;
  setUserDetail: Dispatch<SetStateAction<OrganizationUserDetail | null>>;
}) {
  const {
    isOperationActive,
    organizationId,
    orgManagerActions,
    setError,
    setGrants,
    setGroupContainers,
    setMutating,
    setUserDetail,
  } = input;

  return useCallback(
    async (grant: OrganizationContainerGrant) => {
      if (grant.isBuiltin || !organizationId) {
        return;
      }

      await runScopedOrgMutation({
        isOperationActive,
        operationOrganizationId: organizationId,
        run: async () => {
          await orgManagerActions.revokeGrant(grant);
          if (!isOperationActive(organizationId)) {
            return;
          }
          setGrants((current) =>
            removeRevokedGrantFromGrantState(current, grant),
          );
          setGroupContainers((current) =>
            removeRevokedGrantFromGroupContainers(current, grant),
          );
          setUserDetail((current) =>
            removeRevokedGrantFromUserDetail(current, grant),
          );
        },
        setError,
        setMutating,
      });
    },
    [
      isOperationActive,
      organizationId,
      orgManagerActions,
      setError,
      setGrants,
      setGroupContainers,
      setMutating,
      setUserDetail,
    ],
  );
}
