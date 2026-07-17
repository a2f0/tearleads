import type { DomainScope } from "../data/domainScope";
import {
  loadLocalOrganizationDirectoryAndGroups,
  type OrganizationDirectoryAndGroups,
  reconcileOrganizationDirectoryAndGroups,
} from "../workflows/organizations";
import type {
  InternalRuntime,
  InternalWorkflowRuntimeInput,
} from "./workflowRuntime";

interface ActiveOrganizationReadModelRuntime {
  readonly runtime: InternalWorkflowRuntimeInput;
  readonly organizationId: string;
  readonly userId: string;
}

export interface OrganizationReadModelCoordinator {
  loadLocal(
    organizationId?: string | undefined,
  ): Promise<OrganizationDirectoryAndGroups | null>;
  loadLocalOrReconcile(
    organizationId?: string | undefined,
  ): Promise<OrganizationDirectoryAndGroups | null>;
  reconcile(
    organizationId?: string | undefined,
  ): Promise<OrganizationDirectoryAndGroups | null>;
}

function activeReadModelRuntime(
  runtimeService: InternalRuntime,
  expectedOrganizationId?: string | undefined,
): ActiveOrganizationReadModelRuntime | null {
  const runtime = runtimeService.workflowInput();
  const organizationId = runtime.auth.organizationId;
  const userId = runtime.auth.userId;
  if (
    !runtime.auth.isAuthenticated ||
    !organizationId ||
    !userId ||
    runtime.infra.dbStatus !== "ready" ||
    (expectedOrganizationId !== undefined &&
      organizationId !== expectedOrganizationId)
  ) {
    return null;
  }

  return { runtime, organizationId, userId };
}

function reconciliationKey(input: ActiveOrganizationReadModelRuntime): string {
  return `${input.organizationId}\0${input.userId}`;
}

export function createOrganizationReadModelCoordinator(
  runtimeService: InternalRuntime,
): OrganizationReadModelCoordinator {
  const reconciliationsByScope = new WeakMap<
    DomainScope,
    Map<string, Promise<OrganizationDirectoryAndGroups | null>>
  >();

  const loadLocal = async (organizationId?: string) => {
    const active = activeReadModelRuntime(runtimeService, organizationId);
    if (!active) {
      return null;
    }
    return loadLocalOrganizationDirectoryAndGroups({
      currentUserId: active.userId,
      execSql: active.runtime.infra.execSql,
      organizationId: active.organizationId,
    });
  };

  const reconcile = (organizationId?: string) => {
    const active = activeReadModelRuntime(runtimeService, organizationId);
    if (!active) {
      return Promise.resolve(null);
    }

    const scope = active.runtime.state.domainScope;
    let byKey = reconciliationsByScope.get(scope);
    if (!byKey) {
      byKey = new Map();
      reconciliationsByScope.set(scope, byKey);
    }
    const key = reconciliationKey(active);
    const existing = byKey.get(key);
    if (existing) {
      return existing;
    }

    const reconciliation = reconcileOrganizationDirectoryAndGroups({
      apiClient: active.runtime.apiClient,
      currentUserId: active.userId,
      execSql: active.runtime.infra.execSql,
      logError: active.runtime.util.logError,
      organizationId: active.organizationId,
    }).finally(() => {
      if (byKey?.get(key) === reconciliation) {
        byKey.delete(key);
      }
    });
    byKey.set(key, reconciliation);
    return reconciliation;
  };

  return {
    loadLocal,
    async loadLocalOrReconcile(organizationId) {
      return (await loadLocal(organizationId)) ?? reconcile(organizationId);
    },
    reconcile,
  };
}
