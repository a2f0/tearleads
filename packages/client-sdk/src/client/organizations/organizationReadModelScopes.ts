import { OrganizationReadModelRepository } from "../../data/persistence/organizations/organizationReadModelRepository";
import type { DomainScope } from "../../data/shared/domainScope";
import type { OrganizationDirectoryAndGroups } from "../../workflows/organizations";
import { organizationAccessScopeKey } from "../../workflows/organizations/readModel/organizationPresentationAccessState";
import type { InternalRuntime } from "../runtime/workflowRuntime";
import {
  type ActiveOrganizationDataRuntime,
  isOrganizationDataRuntimeCurrent,
} from "./organizationWorkflowRuntime";

/** A read-model pass in flight: a feed read or a committed delta's apply. */
export interface InFlightReadModelPass {
  readonly kind: "delta" | "feed";
  readonly promise: Promise<OrganizationDirectoryAndGroups | null | undefined>;
}

export function committedScope(
  active: ActiveOrganizationDataRuntime,
  sessionGeneration: number,
) {
  return {
    domainScope: active.runtime.state.domainScope,
    execSql: active.runtime.infra.execSql,
    organizationId: active.organizationId,
    sessionGeneration,
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

/** Whether the scope and session `active` was read in are still current. */
export function sessionIsCurrent(
  runtimeService: InternalRuntime,
  active: ActiveOrganizationDataRuntime,
  sessionGeneration: number,
): () => boolean {
  const { domainScope } = active.runtime.state;
  return () =>
    runtimeService.sessionGeneration === sessionGeneration &&
    isOrganizationDataRuntimeCurrent(runtimeService, active, domainScope);
}

/** The applied read-model cursor, when it is the one this scope presented. */
export async function presentedAppliedCursor(
  active: ActiveOrganizationDataRuntime,
  presentedCursors: ReadonlyMap<string, string>,
): Promise<string | null> {
  const applied = await new OrganizationReadModelRepository(
    active.runtime.infra.execSql,
  ).loadAppliedOrganizationReadModelCursor({
    organizationId: active.organizationId,
    requesterUserId: active.userId,
  });
  const presented = presentedCursors.get(
    organizationAccessScopeKey(active.organizationId, active.userId),
  );
  return applied !== null && applied === presented ? applied : null;
}
