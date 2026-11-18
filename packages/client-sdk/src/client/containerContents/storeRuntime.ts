import { createContainerContentsStoreWorkflowRuntimeFromSnapshot } from "../../workflows/container-contents";
import { requireShareRecipient } from "../organizations/recipientAdmission";
import type { InternalRuntime } from "../runtime/workflowRuntime";

export function createStoreRuntime(service: InternalRuntime) {
  const input = service.workflowInput();
  const scopeGeneration = service.scopeGeneration;
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
    scopeGeneration,
    liveHydrationStatus: (): "retired" | "ready" | "unavailable" => {
      const live = service.publicRuntime.input();
      if (
        service.scopeGeneration !== scopeGeneration ||
        live.state.domainScope !== input.state.domainScope ||
        live.auth.organizationId !== input.auth.organizationId ||
        live.infra.execSql !== input.infra.execSql ||
        live.auth.isAuthenticated !== input.auth.isAuthenticated ||
        live.auth.userId !== input.auth.userId
      )
        return "retired";
      return live.state.online && live.infra.dbStatus === "ready"
        ? "ready"
        : "unavailable";
    },
  };
}
