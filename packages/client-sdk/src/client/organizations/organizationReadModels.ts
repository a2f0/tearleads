import type { DomainScope } from "../../data/domainScope";
import {
  loadLocalOrganizationContainerGrants,
  loadLocalOrganizationDirectoryAndGroups,
  loadLocalOrganizationGroupContainers,
  loadLocalOrganizationGroupMembers,
  loadLocalOrganizationUserDetail,
  type OrganizationContainerGrants,
  type OrganizationDirectoryAndGroups,
  type OrganizationGroupContainers,
  type OrganizationGroupMembers,
  type OrganizationGroupPolicyHistory,
  type OrganizationPolicyHistory,
  type OrganizationUserDetail,
  reconcileOrganizationDirectoryAndGroups,
} from "../../workflows/organizations";
import {
  organizationAccessScopeKey,
  wasOrganizationPresentationAccessDeniedByServer,
} from "../../workflows/organizations/organizationPresentationAccessState";
import type { InternalRuntime } from "../workflowRuntime";
import { recoverOrganizationAccess } from "./organizationAccessRestoration";
import { loadBoundedOrganizationGroupHistory } from "./organizationGroupHistory";
import { hydrateOrganizationGroupNamesForRuntime } from "./organizationGroupNameHydration";
import { loadBoundedOrganizationHistory } from "./organizationHistory";
import {
  type ActiveOrganizationDataRuntime,
  activeOrganizationDataRuntime,
  isOrganizationDataRuntimeCurrent,
} from "./organizationWorkflowRuntime";

const coordinatorsByRuntime = new WeakMap<
  InternalRuntime,
  OrganizationReadModelCoordinator
>();

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
    beforeVersion?: number | undefined,
  ): Promise<OrganizationGroupPolicyHistory | null>;
  loadOrganizationPolicyHistory(
    organizationId?: string | undefined,
    beforeVersion?: number | undefined,
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
  /**
   * Resolves `undefined` when the runtime declines without I/O (offline,
   * database not ready, organization mismatch) or when the feed failed with
   * no locally retained projection — passes that must not count as caught
   * up; `null` when the reconcile completed but produced nothing presentable
   * — including an authoritative denial that purged the projection, which
   * consumers must repaint.
   */
  reconcile(
    organizationId?: string | undefined,
  ): Promise<OrganizationDirectoryAndGroups | null | undefined>;
  reconcileAfterMutation(
    organizationId?: string | undefined,
  ): Promise<OrganizationDirectoryAndGroups | null | undefined>;
}

class OrganizationReadModelCoordinatorImpl
  implements OrganizationReadModelCoordinator
{
  private readonly reconciliationsByScope = new WeakMap<
    DomainScope,
    Map<string, Promise<OrganizationDirectoryAndGroups | null | undefined>>
  >();
  constructor(private readonly runtimeService: InternalRuntime) {}

  private reconciliationMap(active: ActiveOrganizationDataRuntime) {
    const scope = active.runtime.state.domainScope;
    let byKey = this.reconciliationsByScope.get(scope);
    if (!byKey) {
      byKey = new Map();
      this.reconciliationsByScope.set(scope, byKey);
    }
    return byKey;
  }

  async loadLocal(organizationId?: string) {
    const active = activeOrganizationDataRuntime(
      this.runtimeService,
      organizationId,
    );
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
    const active = activeOrganizationDataRuntime(
      this.runtimeService,
      organizationId,
    );
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
    const active = activeOrganizationDataRuntime(
      this.runtimeService,
      organizationId,
    );
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
    const active = activeOrganizationDataRuntime(
      this.runtimeService,
      organizationId,
    );
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

  async loadGroupPolicyHistory(
    groupId: string,
    organizationId?: string,
    beforeVersion?: number,
  ) {
    const active = activeOrganizationDataRuntime(
      this.runtimeService,
      organizationId,
    );
    if (!active || groupId.length === 0) {
      return null;
    }
    const domainScope = active.runtime.state.domainScope;
    return loadBoundedOrganizationGroupHistory({
      active,
      groupId,
      beforeVersion,
      stillCurrent: () =>
        isOrganizationDataRuntimeCurrent(
          this.runtimeService,
          active,
          domainScope,
        ),
    });
  }

  async loadOrganizationPolicyHistory(
    organizationId?: string,
    beforeVersion?: number,
  ) {
    const active = activeOrganizationDataRuntime(
      this.runtimeService,
      organizationId,
    );
    if (!active) return null;
    const domainScope = active.runtime.state.domainScope;
    return loadBoundedOrganizationHistory({
      active,
      beforeVersion,
      stillCurrent: () =>
        isOrganizationDataRuntimeCurrent(
          this.runtimeService,
          active,
          domainScope,
        ),
    });
  }

  async loadLocalUserDetail(userId: string, organizationId?: string) {
    const active = activeOrganizationDataRuntime(
      this.runtimeService,
      organizationId,
    );
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

  reconcile(
    organizationId?: string,
  ): Promise<OrganizationDirectoryAndGroups | null | undefined> {
    const active = activeOrganizationDataRuntime(
      this.runtimeService,
      organizationId,
    );
    if (!active?.runtime.state.online) {
      return Promise.resolve(undefined);
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

    // Snapshot the server-denied flag before reconciling. A reconcile that
    // flips it back to readable means org access was just restored (e.g. the
    // user was re-added to a group), and any write lanes idled by
    // permission-denied submissions have no self re-arm — regaining access is
    // their retry signal, mirroring how billing recovery re-requests all
    // lanes. Only a genuine server denial counts: a local session reset also
    // marks scopes denied, and re-arming on its first reconcile would race the
    // startup sync passes (e.g. pending-create adoption between panes).
    const accessWasDenied = wasOrganizationPresentationAccessDeniedByServer(
      {
        execSql: active.runtime.infra.execSql,
        organizationId: active.organizationId,
        requesterUserId: active.userId,
      },
      "readModel",
    );
    const domainScope = active.runtime.state.domainScope;
    const stillCurrent = () =>
      isOrganizationDataRuntimeCurrent(
        this.runtimeService,
        active,
        domainScope,
      );

    const reconciliation = reconcileOrganizationDirectoryAndGroups({
      apiClient: active.runtime.apiClient,
      currentUserId: active.userId,
      execSql: active.runtime.infra.execSql,
      logError: active.runtime.util.logError,
      organizationId: active.organizationId,
    })
      .then(async (directoryAndGroups) => {
        if (!stillCurrent()) return null;
        // Feed success restores retry eligibility even if name decryption fails.
        const accessWasRestored =
          accessWasDenied &&
          directoryAndGroups !== null &&
          directoryAndGroups !== undefined;
        if (accessWasRestored)
          await recoverOrganizationAccess({
            active,
            domainScope,
            stillCurrent,
          });
        if (!stillCurrent()) return null;
        return hydrateOrganizationGroupNamesForRuntime(
          this.runtimeService,
          active,
          domainScope,
          directoryAndGroups,
        );
      })
      .finally(() => {
        if (byKey.get(key) === reconciliation) {
          byKey.delete(key);
        }
      });
    byKey.set(key, reconciliation);
    return reconciliation;
  }

  async reconcileAfterMutation(
    organizationId?: string,
  ): Promise<OrganizationDirectoryAndGroups | null | undefined> {
    const active = activeOrganizationDataRuntime(
      this.runtimeService,
      organizationId,
    );
    if (!active?.runtime.state.online) {
      return undefined;
    }
    const existing = this.reconciliationMap(active).get(
      organizationAccessScopeKey(active.organizationId, active.userId),
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
