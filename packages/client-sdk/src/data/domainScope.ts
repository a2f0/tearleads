const domainScopeBrand = Symbol("symcrypt.domainScope");

// Identity token for in-process caches that must rotate together when the
// active database or signing identity changes.
export interface DomainScope {
  readonly [domainScopeBrand]: true;
}

export function createDomainScope(): DomainScope {
  return { [domainScopeBrand]: true } satisfies DomainScope;
}
