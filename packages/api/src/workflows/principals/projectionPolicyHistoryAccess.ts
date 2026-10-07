import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  ContainerWriterProjectionError,
  createContainerWriterProjectionContext,
  resolveContainerAccessProjection,
  resolveContainerAccessProjectionBatch,
} from "../containers/writerProjection";
import { loadCurrentDocumentManifestBundle } from "../documents/documentManifestBundle";
import { verifyStoredDocumentManifest } from "../documents/storedDocumentManifestVerification";
import { requireDirectOrganizationAccess } from "../organizations/access";
import type { ProjectionPolicyHistoryScope } from "./projectionPolicyHistoryGrant";
import { PrincipalPolicyError } from "./shared";

/** Read capabilities pin historical evidence, but do not freeze the reader's access. */
export async function assertProjectionPolicyHistoryAccess(
  executor: DatabaseSession,
  scope: ProjectionPolicyHistoryScope,
): Promise<void> {
  if (scope.objectKind === "organization") {
    if (scope.objectId !== scope.organizationId)
      throw new PrincipalPolicyError("Organization history scope differs", 403);
    await requireDirectOrganizationAccess({
      executor,
      organizationId: scope.organizationId,
      userId: scope.userId,
    });
    return;
  }
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
  const candidates = await resolveContainerAccessProjectionBatch({
    executor,
    context,
    userId: scope.userId,
    containerIds: manifest.state.linkedContainerIds,
    minimumAccessLevel: "read",
  });
  for (const candidate of candidates.values()) {
    if (
      candidate.status === "rejected" &&
      !(
        candidate.reason instanceof ContainerWriterProjectionError &&
        candidate.reason.status === 403
      )
    )
      throw candidate.reason;
  }
  if (
    ![...candidates.values()].some(
      (candidate) =>
        candidate.status === "fulfilled" &&
        candidate.value.verifiedPath.at(-1)?.state.organizationId ===
          scope.organizationId,
    )
  )
    throw new PrincipalPolicyError(
      "Projection policy history access denied",
      403,
    );
}
