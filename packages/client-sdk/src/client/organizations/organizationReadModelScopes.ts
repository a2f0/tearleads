import type { DomainScope } from "../../data/shared/domainScope";
import type { OrganizationDirectoryAndGroups } from "../../workflows/organizations";
import type { ActiveOrganizationDataRuntime } from "./organizationWorkflowRuntime";

/** A read-model pass in flight: a feed read or a committed delta's apply. */
export interface InFlightReadModelPass {
  readonly kind: "delta" | "feed";
  readonly promise: Promise<OrganizationDirectoryAndGroups | null | undefined>;
}

export function committedScope(active: ActiveOrganizationDataRuntime) {
  return {
    domainScope: active.runtime.state.domainScope,
    execSql: active.runtime.infra.execSql,
    organizationId: active.organizationId,
    userId: active.userId,
  };
}

export function scopedMap<T>(
  byScope: WeakMap<DomainScope, Map<string, T>>,
  active: ActiveOrganizationDataRuntime,
): Map<string, T> {
  const scope = active.runtime.state.domainScope;
  let byKey = byScope.get(scope);
  if (!byKey) {
    byKey = new Map();
    byScope.set(scope, byKey);
  }
  return byKey;
}
