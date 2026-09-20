import type {
  ContainerWriterProjectionResponse,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import { MAX_INLINE_CONTAINER_REKEYS } from "@tearleads/validators/util";
import type { MaterializedContainerRekeyPlan } from "../../data/containers/shared/types";
import { buildMaterializedContainerRekeyPlan } from "../containers/child/rekey";
import type { SyncRemoteDocumentInput } from "./readOnlySync";
import { applyContainerRekeyPlan } from "./syncContainerRekeyProjection";

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
    if (sync.stillCurrent?.() === false) {
      throw new Error("Document ancestor repair was superseded");
    }
    if (plannedIds.has(previousProjection.containerId)) {
      throw new Error("Document ancestor repair has conflicting paths");
    }
    const planned = await buildMaterializedContainerRekeyPlan({
      author: {
        ...sync.author,
        organizationId: previousProjection.organizationId,
      },
      persistVerificationCheckpoints: false,
      previousProjection,
      signedAt: sync.signedAt,
      targetSecretKey: sync.targetSecretKey,
      resolveProjectionUserKey: sync.resolveProjectionUserKey,
      stillCurrent: sync.stillCurrent,
      warmReferencedPrincipalPolicies: sync.warmReferencedPrincipalPolicies,
      execSql: sync.execSql,
    });
    plannedIds.add(previousProjection.containerId);
    plans.push(planned);
    projection = await applyContainerRekeyPlan(projection, planned);
  }
}
