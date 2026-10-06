import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  createContainerWriterProjectionContext,
  resolveContainerAccessProjection,
} from "../containers/writerProjection";
import { loadCurrentDocumentManifestBundle } from "../documents/documentManifestBundle";
import { verifyStoredDocumentManifest } from "../documents/storedDocumentManifestVerification";
import { resolveAuthorizingContainerPathCandidates } from "../documents/writerProjectionContainerPaths";
import type { ProjectionPolicyHistoryScope } from "./projectionPolicyHistoryGrant";
import { PrincipalPolicyError } from "./shared";

/** Read capabilities pin historical evidence, but do not freeze the reader's access. */
export async function assertProjectionPolicyHistoryAccess(
  executor: DatabaseSession,
  scope: ProjectionPolicyHistoryScope,
): Promise<void> {
  const context = createContainerWriterProjectionContext(executor);
  if (scope.objectKind === "container") {
    const access = await resolveContainerAccessProjection({
      executor,
      context,
      containerId: scope.objectId,
      userId: scope.userId,
      minimumAccessLevel: "read",
    });
    if (
      access.verifiedPath.at(-1)?.state.organizationId !== scope.organizationId
    )
      throw new PrincipalPolicyError(
        "Projection policy history access denied",
        403,
      );
    return;
  }
  const bundle = await loadCurrentDocumentManifestBundle(
    executor,
    scope.objectId,
  );
  const manifest = await verifyStoredDocumentManifest({
    bundle,
    containerContext: context,
  });
  if (manifest.state.organizationId !== scope.organizationId)
    throw new PrincipalPolicyError(
      "Projection policy history access denied",
      403,
    );
  const candidates = await resolveAuthorizingContainerPathCandidates({
    executor,
    context,
    userId: scope.userId,
    containerIds: manifest.state.linkedContainerIds,
  });
  if (
    !candidates.paths.some(
      (path) => path.organizationId === scope.organizationId,
    )
  )
    throw new PrincipalPolicyError(
      "Projection policy history access denied",
      403,
    );
}
