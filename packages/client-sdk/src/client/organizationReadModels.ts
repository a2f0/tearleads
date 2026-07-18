import type { DomainScope } from "../data/domainScope";
import {
  loadLocalOrganizationContainerGrants,
  loadLocalOrganizationDirectoryAndGroups,
  loadLocalOrganizationGroupContainers,
  loadLocalOrganizationGroupMembers,
  loadLocalOrganizationGroupPolicyHistory,
  loadLocalOrganizationPolicyHistory,
  loadLocalOrganizationPolicyReference,
  loadLocalOrganizationUserDetail,
  type OrganizationContainerGrants,
  type OrganizationDirectoryAndGroups,
  type OrganizationGroupContainers,
  type OrganizationGroupMembers,
  type OrganizationGroupPolicyHistory,
  type OrganizationPolicyHistory,
  type OrganizationUserDetail,
  reconcileOrganizationDirectoryAndGroups,
} from "../workflows/organizations";
import { createRuntimePrincipalPolicyWarmer } from "../workflows/principals/runtimePolicyWarmer";
import type {
  InternalRuntime,
  InternalWorkflowRuntimeInput,
} from "./workflowRuntime";

const coordinatorsByRuntime = new WeakMap<
  InternalRuntime,
  OrganizationReadModelCoordinator
>();

interface ActiveOrganizationReadModelRuntime {
  readonly runtime: InternalWorkflowRuntimeInput;
  readonly organizationId: string;
  readonly userId: string;
}

export interface OrganizationReadModelCoordinator {
  loadLocal(
    organizationId?: string | undefined,
  ): Promise<OrganizationDirectoryAndGroups | null>;
  loadLocalGroupMembers(
    groupId: string,
    organizationId?: string | undefined,
  ): Promise<OrganizationGroupMembers | null>;
  loadGroupPolicyHistory(
    groupId: string,
    organizationId?: string | undefined,
  ): Promise<OrganizationGroupPolicyHistory | null>;
  loadOrganizationPolicyHistory(
    organizationId?: string | undefined,
  ): Promise<OrganizationPolicyHistory | null>;
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
  private readonly policyWarmersByScope = new WeakMap<
    DomainScope,
    Map<string, Promise<void>>
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

  private policyWarmerMap(active: ActiveOrganizationReadModelRuntime) {
    const scope = active.runtime.state.domainScope;
    let byKey = this.policyWarmersByScope.get(scope);
    if (!byKey) {
      byKey = new Map();
      this.policyWarmersByScope.set(scope, byKey);
    }
    return byKey;
  }

  private async warmPolicyReference(
    active: ActiveOrganizationReadModelRuntime,
    reference: NonNullable<
      Awaited<ReturnType<typeof loadLocalOrganizationPolicyReference>>
    >,
  ): Promise<void> {
    if (!active.runtime.state.online) {
      return;
    }
    const byKey = this.policyWarmerMap(active);
    const key = `${active.organizationId}\0${reference.principalType}\0${reference.principalId}\0${reference.stateHash}`;
    const existing = byKey.get(key);
    if (existing) {
      return existing;
    }
    const warming = createRuntimePrincipalPolicyWarmer(active.runtime)({
      organizationId: active.organizationId,
      references: [reference],
    }).finally(() => {
      if (byKey.get(key) === warming) {
        byKey.delete(key);
      }
    });
    byKey.set(key, warming);
    return warming;
  }

  private async loadPolicyHistoryAfterWarm<History>(input: {
    readonly active: ActiveOrganizationReadModelRuntime;
    readonly loadLocal: () => Promise<History | null>;
    readonly principalId: string;
    readonly principalType: "group" | "organization";
  }): Promise<History | null> {
    try {
      const local = await input.loadLocal();
      if (local) {
        return local;
      }
    } catch (error) {
      input.active.runtime.util.logError(
        "Failed to load verified organization policy history",
        error,
      );
    }
    if (!input.active.runtime.state.online) {
      return null;
    }

    let reference: Awaited<
      ReturnType<typeof loadLocalOrganizationPolicyReference>
    >;
    try {
      reference = await loadLocalOrganizationPolicyReference({
        currentUserId: input.active.userId,
        execSql: input.active.runtime.infra.execSql,
        organizationId: input.active.organizationId,
        principalId: input.principalId,
        principalType: input.principalType,
      });
    } catch (error) {
      input.active.runtime.util.logError(
        "Failed to load organization policy-head projection",
        error,
      );
      return null;
    }
    if (!reference) {
      return null;
    }

    await this.warmPolicyReference(input.active, reference);
    try {
      return await input.loadLocal();
    } catch (error) {
      input.active.runtime.util.logError(
        "Failed to reload verified organization policy history",
        error,
      );
      return null;
    }
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

  async loadGroupPolicyHistory(groupId: string, organizationId?: string) {
    const active = activeReadModelRuntime(this.runtimeService, organizationId);
    if (!active || groupId.length === 0) {
      return null;
    }
    return this.loadPolicyHistoryAfterWarm({
      active,
      loadLocal: () =>
        loadLocalOrganizationGroupPolicyHistory({
          currentUserId: active.userId,
          execSql: active.runtime.infra.execSql,
          groupId,
          organizationId: active.organizationId,
        }),
      principalId: groupId,
      principalType: "group",
    });
  }

  async loadOrganizationPolicyHistory(organizationId?: string) {
    const active = activeReadModelRuntime(this.runtimeService, organizationId);
    if (!active) {
      return null;
    }
    return this.loadPolicyHistoryAfterWarm({
      active,
      loadLocal: () =>
        loadLocalOrganizationPolicyHistory({
          currentUserId: active.userId,
          execSql: active.runtime.infra.execSql,
          organizationId: active.organizationId,
        }),
      principalId: active.organizationId,
      principalType: "organization",
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

  reconcile(organizationId?: string) {
    const active = activeReadModelRuntime(this.runtimeService, organizationId);
    if (!active || !active.runtime.state.online) {
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
    if (!active || !active.runtime.state.online) {
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
  const existing = coordinatorsByRuntime.get(runtimeService);
  if (existing) {
    return existing;
  }

  const coordinator = new OrganizationReadModelCoordinatorImpl(runtimeService);
  coordinatorsByRuntime.set(runtimeService, coordinator);
  return coordinator;
}
