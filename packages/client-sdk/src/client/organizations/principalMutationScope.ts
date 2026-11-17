import type { InternalRuntime } from "../runtime/workflowRuntime";

/** Capture a mutation's identity/database lifetime without freezing live status. */
export function currentOrganizationMutation(
  service: Pick<InternalRuntime, "workflowInput" | "sessionGeneration">,
  allowTokenRenewal = false,
) {
  const runtime = service.workflowInput();
  const sessionGeneration = service.sessionGeneration;
  return {
    runtime,
    stillCurrent: () => {
      const current = service.workflowInput();
      return (
        // Journal API custody survives token renewal, but its identity,
        // organization and storage generation are still bound immutably.
        (allowTokenRenewal
          ? current.apiClient === runtime.apiClient
          : service.sessionGeneration === sessionGeneration) &&
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

/** A signed mutation's scope: the client's fixed trust domain and its lifetime. */
export function currentOrganizationSigningMutation(
  service: Pick<
    InternalRuntime,
    "identityTrustDomain" | "workflowInput" | "sessionGeneration"
  >,
) {
  return {
    identityTrustDomain: service.identityTrustDomain,
    ...currentOrganizationMutation(service),
  };
}
