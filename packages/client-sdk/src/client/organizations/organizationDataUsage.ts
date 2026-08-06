import type { DomainScope } from "../../data/domainScope";
import {
  loadLocalOrganizationDataUsage,
  type OrganizationDataUsage,
  reconcileOrganizationDataUsage,
} from "../../workflows/organizations";
import { organizationAccessScopeKey } from "../../workflows/organizations/organizationPresentationAccessState";
import type {
  InternalRuntime,
  InternalWorkflowRuntimeInput,
} from "../workflowRuntime";

const coordinatorsByRuntime = new WeakMap<
  InternalRuntime,
  OrganizationDataUsageCoordinator
>();

interface ActiveOrganizationDataUsageRuntime {
  readonly organizationId: string;
  readonly runtime: InternalWorkflowRuntimeInput;
  readonly userId: string;
}

export interface OrganizationDataUsageCoordinator {
  loadLocal(
    organizationId?: string | undefined,
  ): Promise<OrganizationDataUsage | null>;
  /** Undefined means no authoritative result was available for this runtime. */
  reconcile(
    organizationId?: string | undefined,
  ): Promise<OrganizationDataUsage | null | undefined>;
}

function activeDataUsageRuntime(
  runtimeService: InternalRuntime,
  expectedOrganizationId?: string | undefined,
): ActiveOrganizationDataUsageRuntime | null {
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

  return { organizationId, runtime, userId };
}

class OrganizationDataUsageCoordinatorImpl
  implements OrganizationDataUsageCoordinator
{
  private readonly reconciliationsByScope = new WeakMap<
    DomainScope,
    Map<string, Promise<OrganizationDataUsage | null | undefined>>
  >();

  constructor(private readonly runtimeService: InternalRuntime) {}

  private reconciliationMap(active: ActiveOrganizationDataUsageRuntime) {
    const scope = active.runtime.state.domainScope;
    let byKey = this.reconciliationsByScope.get(scope);
    if (!byKey) {
      byKey = new Map();
      this.reconciliationsByScope.set(scope, byKey);
    }
    return byKey;
  }

  async loadLocal(organizationId?: string) {
    const active = activeDataUsageRuntime(this.runtimeService, organizationId);
    if (!active) {
      return null;
    }

    try {
      return await loadLocalOrganizationDataUsage({
        execSql: active.runtime.infra.execSql,
        organizationId: active.organizationId,
        requesterUserId: active.userId,
      });
    } catch (error) {
      active.runtime.util.logError(
        "Failed to load local organization data usage",
        error,
      );
      return null;
    }
  }

  reconcile(organizationId?: string) {
    const active = activeDataUsageRuntime(this.runtimeService, organizationId);
    if (!active) {
      return Promise.resolve(undefined);
    }
    if (!active.runtime.state.online) {
      return this.loadLocal(active.organizationId).then(
        (local) => local ?? undefined,
      );
    }

    const byKey = this.reconciliationMap(active);
    const key = organizationAccessScopeKey(
      active.organizationId,
      active.userId,
    );
    const existing = byKey.get(key);
    if (existing) {
      return existing;
    }

    const reconciliation = reconcileOrganizationDataUsage({
      apiClient: active.runtime.apiClient,
      execSql: active.runtime.infra.execSql,
      logError: active.runtime.util.logError,
      organizationId: active.organizationId,
      requesterUserId: active.userId,
    }).finally(() => {
      if (byKey.get(key) === reconciliation) {
        byKey.delete(key);
      }
    });
    byKey.set(key, reconciliation);
    return reconciliation;
  }
}

export function createOrganizationDataUsageCoordinator(
  runtimeService: InternalRuntime,
): OrganizationDataUsageCoordinator {
  const existing = coordinatorsByRuntime.get(runtimeService);
  if (existing) {
    return existing;
  }

  const coordinator = new OrganizationDataUsageCoordinatorImpl(runtimeService);
  coordinatorsByRuntime.set(runtimeService, coordinator);
  return coordinator;
}
