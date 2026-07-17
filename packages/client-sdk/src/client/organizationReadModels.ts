import type { DomainScope } from "../data/domainScope";
import {
  loadLocalOrganizationContainerGrants,
  loadLocalOrganizationDirectoryAndGroups,
  loadLocalOrganizationGroupContainers,
  loadLocalOrganizationGroupMembers,
  loadLocalOrganizationGroupPolicyHistory,
  loadLocalOrganizationUserDetail,
  type OrganizationContainerGrants,
  type OrganizationDirectoryAndGroups,
  type OrganizationGroupContainers,
  type OrganizationGroupMembers,
  type OrganizationGroupPolicyHistory,
  type OrganizationUserDetail,
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
  loadLocalGroupMembers(
    groupId: string,
    organizationId?: string | undefined,
  ): Promise<OrganizationGroupMembers | null>;
  loadLocalGroupPolicyHistory(
    groupId: string,
    organizationId?: string | undefined,
  ): Promise<OrganizationGroupPolicyHistory | null>;
  loadLocalGrants(
    organizationId?: string | undefined,
  ): Promise<OrganizationContainerGrants | null>;
  loadLocalGroupContainers(
    groupId: string,
    organizationId?: string | undefined,
  ): Promise<OrganizationGroupContainers | null>;
  loadLocalUserDetail(
    userId: string,
    organizationId?: string | undefined,
  ): Promise<OrganizationUserDetail | null>;
  reconcile(
    organizationId?: string | undefined,
  ): Promise<OrganizationDirectoryAndGroups | null>;
  reconcileAfterMutation(
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

class OrganizationReadModelCoordinatorImpl
  implements OrganizationReadModelCoordinator
{
  private readonly reconciliationsByScope = new WeakMap<
    DomainScope,
    Map<string, Promise<OrganizationDirectoryAndGroups | null>>
  >();

  constructor(private readonly runtimeService: InternalRuntime) {}

  private reconciliationMap(active: ActiveOrganizationReadModelRuntime) {
    const scope = active.runtime.state.domainScope;
    let byKey = this.reconciliationsByScope.get(scope);
    if (!byKey) {
      byKey = new Map();
      this.reconciliationsByScope.set(scope, byKey);
    }
    return byKey;
  }

  async loadLocal(organizationId?: string) {
    const active = activeReadModelRuntime(this.runtimeService, organizationId);
    if (!active) {
      return null;
    }
    return loadLocalOrganizationDirectoryAndGroups({
      currentUserId: active.userId,
      execSql: active.runtime.infra.execSql,
      organizationId: active.organizationId,
    });
  }

  async loadLocalGrants(organizationId?: string) {
    const active = activeReadModelRuntime(this.runtimeService, organizationId);
    if (!active) {
      return null;
    }
    return loadLocalOrganizationContainerGrants({
      currentUserId: active.userId,
      execSql: active.runtime.infra.execSql,
      organizationId: active.organizationId,
    });
  }

  async loadLocalGroupContainers(groupId: string, organizationId?: string) {
    const active = activeReadModelRuntime(this.runtimeService, organizationId);
    if (!active || groupId.length === 0) {
      return null;
    }
    return loadLocalOrganizationGroupContainers({
      currentUserId: active.userId,
      execSql: active.runtime.infra.execSql,
      groupId,
      organizationId: active.organizationId,
    });
  }

  async loadLocalGroupMembers(groupId: string, organizationId?: string) {
    const active = activeReadModelRuntime(this.runtimeService, organizationId);
    if (!active || groupId.length === 0) {
      return null;
    }
    return loadLocalOrganizationGroupMembers({
      currentUserId: active.userId,
      execSql: active.runtime.infra.execSql,
      groupId,
      organizationId: active.organizationId,
    });
  }

  async loadLocalGroupPolicyHistory(groupId: string, organizationId?: string) {
    const active = activeReadModelRuntime(this.runtimeService, organizationId);
    if (!active || groupId.length === 0) {
      return null;
    }
    return loadLocalOrganizationGroupPolicyHistory({
      currentUserId: active.userId,
      execSql: active.runtime.infra.execSql,
      groupId,
      organizationId: active.organizationId,
    });
  }

  async loadLocalUserDetail(userId: string, organizationId?: string) {
    const active = activeReadModelRuntime(this.runtimeService, organizationId);
    if (!active || userId.length === 0) {
      return null;
    }
    return loadLocalOrganizationUserDetail({
      currentUserId: active.userId,
      execSql: active.runtime.infra.execSql,
      organizationId: active.organizationId,
      userId,
    });
  }

  async loadLocalOrReconcile(organizationId?: string) {
    return (
      (await this.loadLocal(organizationId)) ?? this.reconcile(organizationId)
    );
  }

  reconcile(organizationId?: string) {
    const active = activeReadModelRuntime(this.runtimeService, organizationId);
    if (!active) {
      return Promise.resolve(null);
    }

    const byKey = this.reconciliationMap(active);
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
      if (byKey.get(key) === reconciliation) {
        byKey.delete(key);
      }
    });
    byKey.set(key, reconciliation);
    return reconciliation;
  }

  async reconcileAfterMutation(organizationId?: string) {
    const active = activeReadModelRuntime(this.runtimeService, organizationId);
    if (!active) {
      return null;
    }
    const existing = this.reconciliationMap(active).get(
      reconciliationKey(active),
    );
    if (existing) {
      await existing.catch(() => null);
    }
    return this.reconcile(active.organizationId);
  }
}

export function createOrganizationReadModelCoordinator(
  runtimeService: InternalRuntime,
): OrganizationReadModelCoordinator {
  return new OrganizationReadModelCoordinatorImpl(runtimeService);
}
