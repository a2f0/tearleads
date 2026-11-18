import type { OrganizationReadModelDeltaResponse } from "@tearleads/validators/response";
import { OrganizationReadModelRepository } from "../../data/persistence/organizations/organizationReadModelRepository";
import type { DomainScope } from "../../data/shared/domainScope";
import {
  applyCommittedOrganizationReadModel,
  type CommittedReadModelOffer,
  loadHeldOrganizationReadModelCursor,
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
  takeCommittedReadModelOffer,
  takeCommittedReadModelOffers,
  withVerifiedLeaveRequests,
  withVerifiedUserLeaveRequest,
} from "../../workflows/organizations";
import { organizationAccessScopeKey } from "../../workflows/organizations/readModel/organizationPresentationAccessState";
import type { InternalRuntime } from "../runtime/workflowRuntime";
import { loadBoundedOrganizationGroupHistory } from "./organizationGroupHistory";
import { loadBoundedOrganizationHistory } from "./organizationHistory";
import { leaveRequestVerifier } from "./organizationLeaveRequestVerifier";
import { presentOrganizationReadModelPass } from "./organizationReadModelPresentation";
import {
  committedScope,
  type InFlightReadModelPass,
  scopedMap,
} from "./organizationReadModelScopes";
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
   * database not ready, organization mismatch) or when the feed failed,
   * even with locally retained data — passes that must not count as caught
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
  /**
   * Apply the read-model delta this device's own mutation response carried,
   * with no request. Resolves `undefined` when it is not applied (no delta,
   * another scope, or the projection moved past the cursor the mutation held).
   */
  applyCommittedReadModel(
    organizationId: string,
    delta: OrganizationReadModelDeltaResponse | undefined,
  ): Promise<OrganizationDirectoryAndGroups | null | undefined>;
  /**
   * The post-commit read of this device's own mutation: its response's delta
   * when that applies and presents, otherwise `reconcileAfterMutation`.
   */
  reconcileAfterOwnMutation(
    organizationId: string,
    delta: OrganizationReadModelDeltaResponse | undefined,
  ): Promise<OrganizationDirectoryAndGroups | null | undefined>;
  /** The applied cursor once this scope's in-flight reconcile settles. */
  loadAppliedCursor(
    organizationId?: string | undefined,
  ): Promise<string | null>;
}

class OrganizationReadModelCoordinatorImpl
  implements OrganizationReadModelCoordinator
{
  // The pass in flight per requester: a feed read, or a committed delta's
  // local apply, which a feed refresh waits out instead of joining.
  private readonly reconciliationsByScope = new WeakMap<
    DomainScope,
    Map<string, InFlightReadModelPass>
  >();
  // The cursor each requester's last reconcile fully presented: applied,
  // group names hydrated and leave requests verified. A stored cursor whose
  // presentation work failed does not count as applied, so the next hint
  // reconciles and retries that work.
  private readonly presentedCursorsByScope = new WeakMap<
    DomainScope,
    Map<string, string>
  >();
  constructor(private readonly runtimeService: InternalRuntime) {}

  private reconciliationMap(active: ActiveOrganizationDataRuntime) {
    return scopedMap(this.reconciliationsByScope, active);
  }

  async loadLocal(organizationId?: string) {
    const active = activeOrganizationDataRuntime(
      this.runtimeService,
      organizationId,
    );
    if (!active) {
      return null;
    }
    return withVerifiedLeaveRequests(
      await loadLocalOrganizationDirectoryAndGroups({
        currentUserId: active.userId,
        execSql: active.runtime.infra.execSql,
        organizationId: active.organizationId,
      }),
      leaveRequestVerifier(this.runtimeService, active.runtime, active),
    );
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
    return withVerifiedUserLeaveRequest(
      await loadLocalOrganizationUserDetail({
        currentUserId: active.userId,
        execSql: active.runtime.infra.execSql,
        organizationId: active.organizationId,
        userId,
      }),
      active.organizationId,
      leaveRequestVerifier(this.runtimeService, active.runtime, active),
    );
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
    const inFlight = this.reconciliationMap(active).get(
      organizationAccessScopeKey(active.organizationId, active.userId),
    );
    // A delta's apply reflects its commit, not this request: read after it.
    if (inFlight?.kind === "delta") {
      return inFlight.promise
        .catch(() => null)
        .then(() => this.reconcile(active.organizationId));
    }
    return this.presentReconciliation(active, "feed", () =>
      reconcileOrganizationDirectoryAndGroups({
        apiClient: active.runtime.apiClient,
        currentUserId: active.userId,
        execSql: active.runtime.infra.execSql,
        logError: active.runtime.util.logError,
        organizationId: active.organizationId,
      }),
    );
  }

  /** Run one projection pass for the scope, then present what it applied. */
  private presentReconciliation(
    active: ActiveOrganizationDataRuntime,
    kind: InFlightReadModelPass["kind"],
    pass: () => Promise<OrganizationDirectoryAndGroups | null | undefined>,
  ): Promise<OrganizationDirectoryAndGroups | null | undefined> {
    const byKey = this.reconciliationMap(active);
    const key = organizationAccessScopeKey(
      active.organizationId,
      active.userId,
    );
    const existing = byKey.get(key);
    if (existing) {
      return existing.promise;
    }
    const presentedCursors = scopedMap(this.presentedCursorsByScope, active);

    const reconciliation = presentOrganizationReadModelPass(
      this.runtimeService,
      active,
      pass,
    )
      .then(
        (presented) => {
          if (presented) presentedCursors.set(key, presented.readModelCursor);
          // A delta that did not apply leaves what was presented standing.
          else if (kind === "feed") presentedCursors.delete(key);
          return presented;
        },
        (error: unknown) => {
          presentedCursors.delete(key);
          throw error;
        },
      )
      .finally(() => {
        if (byKey.get(key)?.promise === reconciliation) {
          byKey.delete(key);
        }
      });
    byKey.set(key, { kind, promise: reconciliation });
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
    await this.settleInFlightReconcile(active);
    return this.reconcile(active.organizationId);
  }

  async applyCommittedReadModel(
    organizationId: string,
    delta: OrganizationReadModelDeltaResponse | undefined,
  ): Promise<OrganizationDirectoryAndGroups | null | undefined> {
    const active = activeOrganizationDataRuntime(
      this.runtimeService,
      organizationId,
    );
    const offer =
      active && delta
        ? takeCommittedReadModelOffer(committedScope(active), delta)
        : undefined;
    if (!active || !offer) return undefined;
    await this.settleInFlightReconcile(active);
    return this.applyCommittedOffer(active, offer);
  }

  /**
   * Present an offer only while the projection still holds the cursor its
   * mutation sent and the scope is the one that waited for it. A failure only
   * forgoes the delta: the caller reads the feed.
   */
  private applyCommittedOffer(
    active: ActiveOrganizationDataRuntime,
    offer: CommittedReadModelOffer,
  ): Promise<OrganizationDirectoryAndGroups | null | undefined> {
    const { domainScope } = active.runtime.state;
    return this.presentReconciliation(active, "delta", async () => {
      const held = await loadHeldOrganizationReadModelCursor(
        committedScope(active),
      );
      if (
        held !== offer.heldCursor ||
        !isOrganizationDataRuntimeCurrent(
          this.runtimeService,
          active,
          domainScope,
        )
      )
        return undefined;
      return applyCommittedOrganizationReadModel({
        currentUserId: active.userId,
        execSql: active.runtime.infra.execSql,
        logError: active.runtime.util.logError,
        organizationId: active.organizationId,
        requestedCursor: offer.heldCursor,
        response: offer.delta,
      });
    }).catch((error: unknown) => {
      active.runtime.util.logError(
        "Failed to apply a committed organization read-model delta",
        error,
      );
      return undefined;
    });
  }

  async reconcileAfterOwnMutation(
    organizationId: string,
    delta: OrganizationReadModelDeltaResponse | undefined,
  ): Promise<OrganizationDirectoryAndGroups | null | undefined> {
    const active = activeOrganizationDataRuntime(
      this.runtimeService,
      organizationId,
    );
    if (!active) return undefined;
    const { domainScope } = active.runtime.state;
    const applied = await this.applyCommittedReadModel(organizationId, delta);
    if (applied) return applied;
    // The fallback reads for the scope that committed, or not at all.
    return isOrganizationDataRuntimeCurrent(
      this.runtimeService,
      active,
      domainScope,
    )
      ? this.reconcileAfterMutation(active.organizationId)
      : undefined;
  }

  async loadAppliedCursor(organizationId?: string): Promise<string | null> {
    const active = activeOrganizationDataRuntime(
      this.runtimeService,
      organizationId,
    );
    if (!active) {
      return null;
    }
    // A hint's cursor check: this scope's own mutations in flight settle
    // first, and the deltas they carried apply, so a hint naming one of those
    // commits needs no read.
    for (const offer of await takeCommittedReadModelOffers(
      committedScope(active),
    )) {
      await this.settleInFlightReconcile(active);
      await this.applyCommittedOffer(active, offer);
    }
    await this.settleInFlightReconcile(active);
    const applied = await new OrganizationReadModelRepository(
      active.runtime.infra.execSql,
    ).loadAppliedOrganizationReadModelCursor({
      organizationId: active.organizationId,
      requesterUserId: active.userId,
    });
    const presented = scopedMap(this.presentedCursorsByScope, active).get(
      organizationAccessScopeKey(active.organizationId, active.userId),
    );
    return applied !== null && applied === presented ? applied : null;
  }

  private async settleInFlightReconcile(
    active: ActiveOrganizationDataRuntime,
  ): Promise<void> {
    await this.reconciliationMap(active)
      .get(organizationAccessScopeKey(active.organizationId, active.userId))
      ?.promise.catch(() => null);
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
