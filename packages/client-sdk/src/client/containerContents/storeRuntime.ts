import { createContainerContentsStoreWorkflowRuntimeFromSnapshot } from "../../workflows/container-contents";
import { requireShareRecipient } from "../organizations/recipientAdmission";
import type { InternalRuntime } from "../runtime/workflowRuntime";

export function createStoreRuntime(service: InternalRuntime) {
  const input = service.workflowInput();
  return {
    ...createContainerContentsStoreWorkflowRuntimeFromSnapshot(
      { ...input, organizations: service.containerContentsOrganizations },
      service.adoptRootContainer,
      (userId, accessLevel) =>
        requireShareRecipient(
          service,
          input.infra.execSql,
          userId,
          accessLevel,
        ),
    ),
    // A superseded store can stop receiving host updates while its retry is pending.
    isScopeCurrent: () => {
      const live = service.publicRuntime.input();
      return (
        live.state.domainScope === input.state.domainScope &&
        live.state.online &&
        live.auth.organizationId === input.auth.organizationId &&
        live.infra.execSql === input.infra.execSql &&
        live.infra.dbStatus === "ready" &&
        live.auth.isAuthenticated === input.auth.isAuthenticated &&
        live.auth.userId === input.auth.userId
      );
    },
  };
}
