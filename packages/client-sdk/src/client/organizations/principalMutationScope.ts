import type { InternalRuntime } from "../workflowRuntime";

/** Capture a mutation's identity/database lifetime without freezing live status. */
export function currentOrganizationMutation(
  service: Pick<InternalRuntime, "workflowInput">,
) {
  const runtime = service.workflowInput();
  return {
    runtime,
    stillCurrent: () => {
      const current = service.workflowInput();
      return (
        current.infra.dbStatus === "ready" &&
        current.infra.execSql === runtime.infra.execSql &&
        current.state.domainScope === runtime.state.domainScope &&
        current.auth.isAuthenticated &&
        current.auth.organizationId === runtime.auth.organizationId &&
        current.auth.userId === runtime.auth.userId &&
        current.crypto.signingFingerprint === runtime.crypto.signingFingerprint
      );
    },
  };
}
