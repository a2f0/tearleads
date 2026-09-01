import type { DomainScope } from "@tearleads/client-sdk";

interface OrgManagerRuntimeScopeInput {
  readonly auth: {
    readonly isAuthenticated: boolean;
    readonly organizationId: string | null;
    readonly userId: string | null;
  };
  readonly crypto: { readonly signingFingerprint: string | null };
  readonly infra: { readonly dbStatus: string };
  readonly state: {
    readonly containerId: string | null;
    readonly domainScope: DomainScope;
  };
}

export interface OrgManagerOperationScope {
  readonly containerId: string;
  readonly domainScope: DomainScope;
  readonly generation: object;
  readonly organizationId: string;
  readonly signingFingerprint: string;
  readonly userId: string;
}

export function captureOrgManagerOperationScope(
  runtime: OrgManagerRuntimeScopeInput,
  generation: object,
): OrgManagerOperationScope | null {
  if (
    !runtime.auth.isAuthenticated ||
    !runtime.auth.organizationId ||
    !runtime.auth.userId ||
    !runtime.crypto.signingFingerprint ||
    runtime.infra.dbStatus !== "ready" ||
    !runtime.state.containerId
  ) {
    return null;
  }

  return {
    containerId: runtime.state.containerId,
    domainScope: runtime.state.domainScope,
    generation,
    organizationId: runtime.auth.organizationId,
    signingFingerprint: runtime.crypto.signingFingerprint,
    userId: runtime.auth.userId,
  };
}

export function isOrgManagerOperationScopeActive(
  scope: OrgManagerOperationScope,
  runtime: OrgManagerRuntimeScopeInput,
  generation: object,
): boolean {
  return (
    scope.generation === generation &&
    runtime.auth.isAuthenticated &&
    runtime.auth.organizationId === scope.organizationId &&
    runtime.auth.userId === scope.userId &&
    runtime.crypto.signingFingerprint === scope.signingFingerprint &&
    runtime.infra.dbStatus === "ready" &&
    runtime.state.containerId === scope.containerId &&
    runtime.state.domainScope === scope.domainScope
  );
}
