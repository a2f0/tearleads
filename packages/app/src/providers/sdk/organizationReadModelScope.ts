import type { DomainScope } from "@tearleads/client-sdk";

/** The exact authenticated domain, organization, and user a read-model
 * demand, pass, or hint belongs to. */
export interface OrganizationReadModelScope {
  readonly domainScope: DomainScope;
  readonly organizationId: string;
  readonly userId: string;
}

export function isSameOrganizationReadModelScope(
  left: OrganizationReadModelScope | null,
  right: OrganizationReadModelScope | null,
): boolean {
  return (
    left !== null &&
    right !== null &&
    left.domainScope === right.domainScope &&
    left.organizationId === right.organizationId &&
    left.userId === right.userId
  );
}
