import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import { ContainerAuthorAccessError } from "../../../data/containers/shared/authorAccess";
import type {
  ContainerMutationAuthor,
  ContainerRekeyApi,
  ContainerShareApi,
} from "../../../data/containers/shared/types";
import { ContainerKekRepairInaccessibleError } from "../../../data/documents/shared/containerKekCurrency";
import { ContainerKekTargetUnreachableError } from "../../../data/documents/shared/containerKekPath";
import type {
  ProjectionUserKeyResolver,
  ReferencedPrincipalPolicyWarmer,
} from "../../../data/keyingProjectionVerification";
import type { SecurityIncidentReporter } from "../../../data/securityIncidents";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { rekeyRemoteContainer } from "./rekeyRemote";

/** The first level on the path, the container included, pinning a retired epoch. */
function firstStaleLevelId(
  projection: ContainerWriterProjectionResponse,
): string | null {
  const keks = projection.containerKeks;
  for (let index = 1; index < keks.length; index += 1) {
    const kek = keks[index];
    if (
      kek &&
      kek.parentContainerKeyEpochId !== keks[index - 1]?.containerKeyEpochId
    ) {
      return kek.containerId;
    }
  }
  return null;
}

/**
 * Repair a stale path down to and including a container before granting on it
 * (#2340).
 *
 * A chain with no grant beneath it may sit lazily stale after an ancestor
 * rotation, since nobody's writes depend on it. The first grant changes that:
 * its grantee could never re-key the levels above its container, so the server
 * refuses a first grant below a stale chain. The container's own edge must be
 * current too, because a grant cites the parent's current epoch and the
 * container's key epoch has to pin it. The sharer administers the container
 * through a grant at or above it, and the levels above that grant are already
 * current, so every stale level here is one the sharer can re-key. These
 * repairs are standalone and need not be atomic with the grant: a repair never
 * strands anyone.
 *
 * Every share does this, not only a first grant, which is all the server
 * insists on. A container that already carries a grant is stale only past the
 * carried-rekey cap or after a group rematerialization, and its grantees are
 * then parked behind exactly these levels; the sharer is already here and able.
 */
export async function projectionWithCurrentAncestors(input: {
  apiClient: ContainerShareApi &
    Partial<Pick<ContainerRekeyApi, "rekeyContainer" | "rekeyContainerResult">>;
  author: ContainerMutationAuthor;
  containerId: string;
  execSql: ExecSql;
  previousProjection: ContainerWriterProjectionResponse;
  reportSecurityIncident: SecurityIncidentReporter;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  stillCurrent?: (() => boolean) | undefined;
  targetSecretKey: Uint8Array;
  warmReferencedPrincipalPolicies?: ReferencedPrincipalPolicyWarmer | undefined;
}): Promise<ContainerWriterProjectionResponse | null> {
  const { rekeyContainer, rekeyContainerResult } = input.apiClient;
  let projection = input.previousProjection;
  // Each round repairs one level, and a path has a bounded number of them.
  for (let round = 0; round < projection.containerKeks.length; round += 1) {
    const staleLevelId = firstStaleLevelId(projection);
    if (staleLevelId === null) return projection;
    // The server would refuse this grant as stale, and no refetch clears that.
    if (!rekeyContainer) {
      throw new ContainerKekRepairInaccessibleError(staleLevelId);
    }
    const repaired = await rekeyRemoteContainer({
      apiClient: {
        getContainerWriterProjection: (containerId) =>
          input.apiClient.getContainerWriterProjection(containerId),
        reciteContainer: (...args) => input.apiClient.reciteContainer(...args),
        rekeyContainer: rekeyContainer.bind(input.apiClient),
        ...(rekeyContainerResult
          ? { rekeyContainerResult: rekeyContainerResult.bind(input.apiClient) }
          : {}),
      },
      author: input.author,
      containerId: staleLevelId,
      execSql: input.execSql,
      reportSecurityIncident: input.reportSecurityIncident,
      resolveProjectionUserKey: input.resolveProjectionUserKey,
      stillCurrent: input.stillCurrent,
      targetSecretKey: input.targetSecretKey,
      warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
    }).catch((error: unknown) => {
      throw error instanceof ContainerAuthorAccessError ||
        error instanceof ContainerKekTargetUnreachableError
        ? new ContainerKekRepairInaccessibleError(staleLevelId)
        : error;
    });
    if (!repaired || input.stillCurrent?.() === false) return null;
    const refreshed = await input.apiClient.getContainerWriterProjection(
      input.containerId,
    );
    if (!refreshed) return null;
    projection = refreshed;
  }
  return firstStaleLevelId(projection) === null ? projection : null;
}
