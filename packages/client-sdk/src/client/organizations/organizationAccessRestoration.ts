import type { DomainScope } from "../../data/domainScope";
import { sqlDocumentMoveIntentPersistence } from "../../data/persistence/container-contents/documentMoveIntentPersistence";
import { requestDormantMetadataRestorationSweeps } from "../../data/persistence/container-contents/dormantMetadataSweep";
import { hasRecordedTerminalSyncFailures } from "../../data/sqlite/documentPersistence";
import {
  requestAllDomainSyncLanes,
  requestDomainSyncLane,
} from "../../data/sync/syncCoordinator";
import { CONTAINER_CONTENTS_SYNC_LANE_KEY } from "../../workflows/container-contents/syncLane";
import type { ActiveOrganizationDataRuntime } from "./organizationWorkflowRuntime";

/** Recover parked work before optional presentation hydration can fail. */
export async function recoverOrganizationAccess(input: {
  readonly active: ActiveOrganizationDataRuntime;
  readonly domainScope: DomainScope;
  readonly stillCurrent: () => boolean;
}): Promise<void> {
  const { active, domainScope, stillCurrent } = input;
  if (!stillCurrent()) return;
  // The evidence gate: re-arm only when some queued write actually
  // recorded a terminal failure. A transient denial during bootstrap
  // (e.g. a read-model 403 before grants propagate) also flips the
  // denied flag, and re-arming then would race the startup sync passes.
  // A failed pass (`undefined`) proves nothing about restored access,
  // so it must not re-arm either.
  if (
    ((await hasRecordedTerminalSyncFailures(active.runtime.infra.execSql)) ||
      (await sqlDocumentMoveIntentPersistence.hasDeniedMoveIntents(
        active.runtime.infra.execSql,
        { organizationId: active.organizationId },
      ))) &&
    stillCurrent()
  ) {
    // Parked permission-denied moves (row 7) only replay once flipped
    // back to pending; restore them before re-arming the lanes.
    await sqlDocumentMoveIntentPersistence.resetDeniedMoveIntents(
      active.runtime.infra.execSql,
      { organizationId: active.organizationId },
    );
    if (stillCurrent()) requestAllDomainSyncLanes(domainScope);
  }
  // Keep dormant cleanup independent from the write-lane evidence gate,
  // but run it afterward so a SQLite failure cannot suppress the
  // pre-existing denied-write and move-intent recovery signal.
  if (stillCurrent()) {
    const requestedDormantSweepCount =
      await requestDormantMetadataRestorationSweeps(
        active.runtime.infra.execSql,
        {
          requesterUserId: active.userId,
        },
      );
    if (requestedDormantSweepCount > 0 && stillCurrent()) {
      requestDomainSyncLane(domainScope, CONTAINER_CONTENTS_SYNC_LANE_KEY);
    }
  }
}
