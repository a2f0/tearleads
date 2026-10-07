import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import { loadProjectionPolicyEvidence } from "../principals/projectionPolicyEvidence";
import { PrincipalPolicyError } from "../principals/shared";
import { DocumentWriterProjectionError } from "./writerProjectionError";

export async function loadDocumentProjectionPolicyEvidence(
  input: Pick<
    DocumentWriterProjectionResponse,
    | "documentManifest"
    | "documentManifestHistory"
    | "documentManifestContainerPaths"
    | "documentContainerManifestHistory"
    | "authorizingContainerPaths"
  > & {
    executor: DatabaseSession;
    organizationId: string;
    documentId: string;
    userId: string;
  },
) {
  try {
    return await loadProjectionPolicyEvidence({
      executor: input.executor,
      scope: {
        organizationId: input.organizationId,
        objectId: input.documentId,
        objectKind: "document",
        userId: input.userId,
      },
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
  } catch (error) {
    if (error instanceof PrincipalPolicyError)
      throw new DocumentWriterProjectionError(error.message, 409);
    throw error;
  }
}
