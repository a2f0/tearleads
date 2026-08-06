import type { DomainScope } from "../../data/domainScope";
import { sqlDocumentMoveIntentPersistence } from "../../data/persistence/container-contents/documentMoveIntentPersistence";
import { requestDormantMetadataRestorationSweeps } from "../../data/persistence/container-contents/dormantMetadataSweep";
import { hasRecordedTerminalSyncFailures } from "../../data/sqlite/documentPersistence";
import {
  requestAllDomainSyncLanes,
  requestDomainSyncLane,
} from "../../data/sync/syncCoordinator";
import { CONTAINER_CONTENTS_SYNC_LANE_KEY } from "../../workflows/container-contents/syncLane";
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
} from "../../workflows/organizations";
import {
  organizationAccessScopeKey,
  wasOrganizationPresentationAccessDeniedByServer,
} from "../../workflows/organizations/organizationPresentationAccessState";
import { createRuntimePrincipalPolicyWarmer } from "../../workflows/principals/runtimePolicyWarmer";
import type {
  InternalRuntime,
  InternalWorkflowRuntimeInput,
} from "../workflowRuntime";

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

class OrganizationReadModelCoordinatorImpl
  implements OrganizationReadModelCoordinator
{
  private readonly reconciliationsByScope = new WeakMap<
    DomainScope,
    Map<string, Promise<OrganizationDirectoryAndGroups | null | undefined>>
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

  reconcile(
    organizationId?: string,
  ): Promise<OrganizationDirectoryAndGroups | null | undefined> {
    const active = activeReadModelRuntime(this.runtimeService, organizationId);
    if (!active || !active.runtime.state.online) {
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

    const reconciliation = reconcileOrganizationDirectoryAndGroups({
      apiClient: active.runtime.apiClient,
      currentUserId: active.userId,
      execSql: active.runtime.infra.execSql,
      logError: active.runtime.util.logError,
      organizationId: active.organizationId,
    })
      .then(async (directoryAndGroups) => {
        const accessWasRestored =
          accessWasDenied &&
          directoryAndGroups !== null &&
          directoryAndGroups !== undefined;
        // The evidence gate: re-arm only when some queued write actually
        // recorded a terminal failure. A transient denial during bootstrap
        // (e.g. a read-model 403 before grants propagate) also flips the
        // denied flag, and re-arming then would race the startup sync passes.
        // A failed pass (`undefined`) proves nothing about restored access,
        // so it must not re-arm either.
        if (
          accessWasRestored &&
          ((await hasRecordedTerminalSyncFailures(
            active.runtime.infra.execSql,
          )) ||
            (await sqlDocumentMoveIntentPersistence.hasDeniedMoveIntents(
              active.runtime.infra.execSql,
              { organizationId: active.organizationId },
            )))
        ) {
          // Parked permission-denied moves (row 7) only replay once flipped
          // back to pending; restore them before re-arming the lanes.
          await sqlDocumentMoveIntentPersistence.resetDeniedMoveIntents(
            active.runtime.infra.execSql,
            { organizationId: active.organizationId },
          );
          requestAllDomainSyncLanes(domainScope);
        }
        // Keep dormant cleanup independent from the write-lane evidence gate,
        // but run it afterward so a SQLite failure cannot suppress the
        // pre-existing denied-write and move-intent recovery signal.
        if (accessWasRestored) {
          const requestedDormantSweepCount =
            await requestDormantMetadataRestorationSweeps(
              active.runtime.infra.execSql,
              {
                requesterUserId: active.userId,
              },
            );
          if (requestedDormantSweepCount > 0) {
            requestDomainSyncLane(
              domainScope,
              CONTAINER_CONTENTS_SYNC_LANE_KEY,
            );
          }
        }
        return directoryAndGroups;
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
    const active = activeReadModelRuntime(this.runtimeService, organizationId);
    if (!active || !active.runtime.state.online) {
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
