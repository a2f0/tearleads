import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import { loadProjectionPolicyEvidence } from "../principals/projectionPolicyEvidence";

export function loadDocumentProjectionPolicyEvidence(
  input: Pick<
    DocumentWriterProjectionResponse,
    | "documentManifest"
    | "documentManifestHistory"
    | "documentManifestContainerPaths"
    | "documentContainerManifestHistory"
    | "authorizingContainerPaths"
  > & { executor: DatabaseSession; organizationId: string },
) {
  return loadProjectionPolicyEvidence({
    executor: input.executor,
    organizationId: input.organizationId,
    bundles: [
      input.documentManifest,
      ...input.documentManifestHistory,
      ...input.documentManifestContainerPaths.flat(),
      ...input.documentContainerManifestHistory,
      ...input.authorizingContainerPaths.flatMap((projection) => [
        ...projection.path,
        ...projection.containerKeks.flatMap(
          (kek) => kek.containerManifestHistory,
        ),
      ]),
    ],
  });
}
