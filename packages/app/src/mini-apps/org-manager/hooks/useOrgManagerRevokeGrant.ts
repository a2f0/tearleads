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
import { setUnknownError } from "../refresh";

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
  return useCallback(
    async (grant: OrganizationContainerGrant) => {
      const operationOrganizationId = input.organizationId;
      if (
        grant.isBuiltin ||
        !operationOrganizationId ||
        !input.isOperationActive(operationOrganizationId)
      ) {
        return;
      }

      input.setMutating(true);
      input.setError(null);
      try {
        await input.orgManagerActions.revokeGrant(grant);
        if (!input.isOperationActive(operationOrganizationId)) {
          return;
        }
        input.setGrants((current) =>
          removeRevokedGrantFromGrantState(current, grant),
        );
        input.setGroupContainers((current) =>
          removeRevokedGrantFromGroupContainers(current, grant),
        );
        input.setUserDetail((current) =>
          removeRevokedGrantFromUserDetail(current, grant),
        );
      } catch (error) {
        if (input.isOperationActive(operationOrganizationId)) {
          setUnknownError(input.setError, error);
        }
      } finally {
        if (input.isOperationActive(operationOrganizationId)) {
          input.setMutating(false);
        }
      }
    },
    [input],
  );
}
