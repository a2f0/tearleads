import { organizationReadModelCursorPosition } from "@tearleads/validators/organizationReadModelCursor";
import type { OrganizationReadModelDeltaResponse } from "@tearleads/validators/response";
import type { DomainScope } from "../../data/shared/domainScope";
import {
  applyCommittedOrganizationReadModel,
  awaitCommittedReadModelOffers,
  type CommittedReadModelOffer,
  type CommittedReadModelOutcome,
  claimCommittedReadModelOffer,
  loadHeldOrganizationReadModelCursor,
  loadLocalOrganizationContainerGrants,
  loadLocalOrganizationDirectoryAndGroups,
  loadLocalOrganizationGroupContainers,
  loadLocalOrganizationGroupMembers,
  loadLocalOrganizationUserDetail,
  type OrganizationDirectoryAndGroups,
  reconcileOrganizationDirectoryAndGroups,
  withVerifiedLeaveRequests,
  withVerifiedUserLeaveRequest,
} from "../../workflows/organizations";
import { organizationAccessScopeKey } from "../../workflows/organizations/readModel/organizationPresentationAccessState";
import type { InternalRuntime } from "../runtime/workflowRuntime";
import { loadBoundedOrganizationGroupHistory } from "./organizationGroupHistory";
import { loadBoundedOrganizationHistory } from "./organizationHistory";
import { leaveRequestVerifier } from "./organizationLeaveRequestVerifier";
import type { OrganizationReadModelCoordinator } from "./organizationReadModelCoordinator";
import { presentOrganizationReadModelPass } from "./organizationReadModelPresentation";
import {
  committedScope,
  type InFlightReadModelPass,
  presentedAppliedCursor,
  scopedMap,
  sessionIsCurrent,
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
    // A delta's apply reflects its commit, not this request: read after it,
    // for this scope only.
    if (inFlight?.kind === "delta") {
      const stillCurrent = sessionIsCurrent(
        this.runtimeService,
        active,
        this.runtimeService.sessionGeneration,
      );
      return inFlight.promise
        .catch(() => null)
        .then(() =>
          stillCurrent() ? this.reconcile(active.organizationId) : null,
        );
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
    passIsCurrent?: () => boolean,
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
      passIsCurrent,
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
  ): Promise<CommittedReadModelOutcome> {
    const active = activeOrganizationDataRuntime(
      this.runtimeService,
      organizationId,
    );
    if (!active || !delta) return undefined;
    const { sessionGeneration } = this.runtimeService;
    // A hint's cursor check may have claimed this delta first; share its apply.
    return claimCommittedReadModelOffer(
      committedScope(active, sessionGeneration),
      delta,
      (offer) => this.applyClaimedOffer(active, offer, sessionGeneration),
    );
  }

  private async applyClaimedOffer(
    active: ActiveOrganizationDataRuntime,
    offer: CommittedReadModelOffer,
    sessionGeneration: number,
  ): Promise<CommittedReadModelOutcome> {
    await this.settleInFlightReconcile(active);
    return this.applyCommittedOffer(active, offer, sessionGeneration);
  }

  /**
   * Present an offer while the projection holds its sent cursor and the scope
   * and session are the ones that waited; a failure only forgoes it.
   */
  private applyCommittedOffer(
    active: ActiveOrganizationDataRuntime,
    offer: CommittedReadModelOffer,
    sessionGeneration: number,
  ): Promise<OrganizationDirectoryAndGroups | null | undefined> {
    const stillCurrent = sessionIsCurrent(
      this.runtimeService,
      active,
      sessionGeneration,
    );
    return this.presentReconciliation(
      active,
      "delta",
      async () => {
        const held = await loadHeldOrganizationReadModelCursor(
          committedScope(active, sessionGeneration),
        );
        if (held !== offer.heldCursor || !stillCurrent()) return undefined;
        return applyCommittedOrganizationReadModel({
          currentUserId: active.userId,
          execSql: active.runtime.infra.execSql,
          logError: active.runtime.util.logError,
          organizationId: active.organizationId,
          requestedCursor: offer.heldCursor,
          response: offer.delta,
          stillCurrent,
        });
      },
      stillCurrent,
    ).catch((error: unknown) => {
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
    const stillCurrent = sessionIsCurrent(
      this.runtimeService,
      active,
      this.runtimeService.sessionGeneration,
    );
    const applied = await this.applyCommittedReadModel(organizationId, delta);
    if (applied) return applied;
    // The fallback reads for the session that committed, or not at all.
    await this.settleInFlightReconcile(active);
    return stillCurrent() ? this.reconcile(active.organizationId) : undefined;
  }

  async loadAppliedCursor(
    hintPosition: bigint,
    organizationId?: string,
  ): Promise<string | null> {
    const active = activeOrganizationDataRuntime(
      this.runtimeService,
      organizationId,
    );
    if (!active) return null;
    const presentedCursors = scopedMap(this.presentedCursorsByScope, active);
    // A hint the presentation already covers waits for nothing.
    const presented = await presentedAppliedCursor(active, presentedCursors);
    if (
      presented !== null &&
      (organizationReadModelCursorPosition(presented, active.organizationId) ??
        -1n) >= hintPosition
    )
      return presented;
    // Otherwise this scope's own mutations that could be the hint's commit
    // settle first, and the deltas they carried apply, so a hint naming one of
    // those commits needs no read.
    const { sessionGeneration } = this.runtimeService;
    const scope = committedScope(active, sessionGeneration);
    for (const offer of await awaitCommittedReadModelOffers(
      scope,
      hintPosition,
    ))
      await claimCommittedReadModelOffer(scope, offer.delta, (claimed) =>
        this.applyClaimedOffer(active, claimed, sessionGeneration),
      );
    await this.settleInFlightReconcile(active);
    return presentedAppliedCursor(active, presentedCursors);
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
