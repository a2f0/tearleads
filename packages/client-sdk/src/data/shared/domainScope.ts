let nextScopeId = 0;
const domainScopeBrand = Symbol("tearleads.domainScope");

// Identity token for in-process caches that must rotate together when the
// active database, signing identity, or sign-in changes.
export interface DomainScope {
  readonly [domainScopeBrand]: true;
  /** Process-local identity for host components that need a scalar key. */
  readonly id: number;
}

export function createDomainScope(): DomainScope {
  return { [domainScopeBrand]: true, id: ++nextScopeId } satisfies DomainScope;
}
