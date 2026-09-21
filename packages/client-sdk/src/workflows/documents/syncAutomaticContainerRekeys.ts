import { KeyingVerificationError } from "@tearleads/crypto";
import type {
  ContainerWriterProjectionResponse,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import { MAX_INLINE_CONTAINER_REKEYS } from "@tearleads/validators/util";
import { ContainerAuthorAccessError } from "../../data/containers/shared/authorAccess";
import type { MaterializedContainerRekeyPlan } from "../../data/containers/shared/types";
import { ContainerKekRepairInaccessibleError } from "../../data/documents/shared/containerKekCurrency";
import { ContainerKekTargetUnreachableError } from "../../data/documents/shared/containerKekPath";
import { assertProjectionVerificationCurrent } from "../../data/keyingProjectionVerification/types";
import { buildMaterializedContainerRekeyPlan } from "../containers/child/rekey";
import type { SyncRemoteDocumentInput } from "./readOnlySync";
import { applyContainerRekeyPlan } from "./syncContainerRekeyProjection";
import { DocumentAncestorRepairAbandonedError } from "./syncRepairAbandon";

function firstStaleContainer(
  projection: DocumentWriterProjectionResponse,
): ContainerWriterProjectionResponse | null {
  for (const path of projection.authorizingContainerPaths) {
    for (let index = 1; index < path.containerKeks.length; index += 1) {
      const parent = path.containerKeks[index - 1];
      const child = path.containerKeks[index];
      if (!parent || !child)
        throw new Error("Container KEK path is incomplete");
      if (child.parentContainerKeyEpochId === parent.containerKeyEpochId) {
        continue;
      }
      return {
        ...path,
        containerId: child.containerId,
        containerKeks: path.containerKeks.slice(0, index + 1),
        path: path.path.slice(0, index + 1),
      };
    }
  }
  return null;
}

/**
 * The stale container is not this writer's to re-key: no wrap on the verified
 * path opens it, or the signed path grants the signer no write access there.
 * Both are judged against the path sliced at the stale container, so a grant
 * held only further down never counts — exactly the API's `container.rekey`
 * rule. Anything else (keyring damage, a forged path) stays an error.
 */
function isRepairInaccessible(error: unknown, containerId: string): boolean {
  return (
    error instanceof ContainerAuthorAccessError ||
    (error instanceof ContainerKekTargetUnreachableError &&
      error.containerId === containerId)
  );
}

/** Prepare parent-first repairs; the sync transaction commits them with the write. */
export async function buildAutomaticContainerRekeys(
  sync: SyncRemoteDocumentInput,
  initialProjection: DocumentWriterProjectionResponse,
): Promise<{ plans: MaterializedContainerRekeyPlan[]; hasMore: boolean }> {
  const plans: MaterializedContainerRekeyPlan[] = [];
  const plannedIds = new Set<string>();
  let projection = initialProjection;
  for (;;) {
    const previousProjection = firstStaleContainer(projection);
    if (!previousProjection) return { plans, hasMore: false };
    if (plans.length >= MAX_INLINE_CONTAINER_REKEYS) {
      return { plans, hasMore: true };
    }
    // Use the shared cancellation sentinel: syncRemoteDocument converts only
    // that to a graceful null, so a plain Error would report a routine
    // generation flip mid-repair as a real sync failure.
    assertProjectionVerificationCurrent(sync.stillCurrent);
    if (plannedIds.has(previousProjection.containerId)) {
      // Abandon like every other routine repair failure: two linked paths
      // disagreeing about a container is a concurrent-rotation race, not a
      // defect, and a raw Error would crash the sync lane instead.
      throw new DocumentAncestorRepairAbandonedError("peer-rotation");
    }
    // Assert rather than adopt: resolveRotationContext compares the verified
    // manifest's organization against the author's, so substituting the path's
    // own organization here would make that the only cross-org check and leave
    // it comparing a server-supplied value with itself.
    if (previousProjection.organizationId !== sync.author.organizationId) {
      throw new KeyingVerificationError(
        "object_mismatch",
        "Document ancestor repair crosses the author's organization",
      );
    }
    const planned = await buildMaterializedContainerRekeyPlan({
      author: sync.author,
      persistVerificationCheckpoints: false,
      previousProjection,
      signedAt: sync.signedAt,
      targetSecretKey: sync.targetSecretKey,
      resolveProjectionUserKey: sync.resolveProjectionUserKey,
      stillCurrent: sync.stillCurrent,
      warmReferencedPrincipalPolicies: sync.warmReferencedPrincipalPolicies,
      execSql: sync.execSql,
    }).catch((error: unknown) => {
      // Repairs run parent-first and access inherits downward, so only the
      // first stale container can be out of reach. Retry-classified like any
      // stale path: one refetch sees a repair a capable member already made.
      throw isRepairInaccessible(error, previousProjection.containerId)
        ? new ContainerKekRepairInaccessibleError(
            previousProjection.containerId,
          )
        : error;
    });
    plannedIds.add(previousProjection.containerId);
    plans.push(planned);
    projection = await applyContainerRekeyPlan(projection, planned);
  }
}
