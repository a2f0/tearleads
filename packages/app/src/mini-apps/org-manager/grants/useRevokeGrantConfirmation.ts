import type { OrganizationContainerGrant } from "@tearleads/client-sdk";
import { useCallback, useState } from "react";
import type { OrgManagerModel } from "../model/useOrgManagerModel";

export function useRevokeGrantConfirmation(
  model: Pick<
    OrgManagerModel,
    | "captureOperationScope"
    | "isOperationScopeActive"
    | "canRevokeGrants"
    | "mutating"
    | "organizationId"
    | "revokeGrant"
  >,
) {
  const [pendingRevoke, setPendingRevoke] = useState<{
    grant: OrganizationContainerGrant;
    scope: NonNullable<ReturnType<OrgManagerModel["captureOperationScope"]>>;
  } | null>(null);
  const grantPendingRevoke =
    pendingRevoke && model.isOperationScopeActive(pendingRevoke.scope)
      ? pendingRevoke.grant
      : null;
  const requestRevokeGrant = useCallback(
    (grant: OrganizationContainerGrant) => {
      if (
        !model.organizationId ||
        !model.canRevokeGrants ||
        model.mutating ||
        grant.isBuiltin
      ) {
        return;
      }

      const scope = model.captureOperationScope();
      if (scope) setPendingRevoke({ grant, scope });
    },
    [
      model.canRevokeGrants,
      model.mutating,
      model.organizationId,
      model.captureOperationScope,
    ],
  );
  const closeRevokeGrantDialog = useCallback(() => {
    setPendingRevoke(null);
  }, []);
  const confirmRevokeGrant = useCallback(() => {
    if (
      !pendingRevoke ||
      !grantPendingRevoke ||
      !model.isOperationScopeActive(pendingRevoke.scope) ||
      !model.canRevokeGrants ||
      model.mutating
    ) {
      return;
    }

    void model.revokeGrant(grantPendingRevoke).finally(() => {
      setPendingRevoke((current) =>
        current === pendingRevoke ? null : current,
      );
    });
  }, [
    grantPendingRevoke,
    model.isOperationScopeActive,
    model.canRevokeGrants,
    model.mutating,
    model.revokeGrant,
    pendingRevoke,
  ]);

  return {
    closeRevokeGrantDialog,
    confirmRevokeGrant,
    grantPendingRevoke,
    requestRevokeGrant,
  };
}
