import { KeyingVerificationError } from "@tearleads/crypto";
import type { BlobAttachmentSummary } from "@tearleads/validators/response";
import type { DocumentWriterProjectionAuthorization } from "../../data/keyingProjectionVerification";
import { ProjectionDependencyUnavailableError } from "../../data/keyingProjectionVerification/dependencyUnavailable";

/** A retained wrap must name a KEK committed by verified container history. */
export function assertBlobWrapScopeVerified(input: {
  authorization: DocumentWriterProjectionAuthorization;
  binding: BlobAttachmentSummary;
  documentId: string;
}): void {
  const targets = input.binding.contentKeyBundle.targets.filter(
    (target) =>
      target.bindingId === input.binding.bindingId &&
      target.documentId === input.documentId,
  );
  if (targets.length === 0)
    throw new KeyingVerificationError(
      "object_mismatch",
      "Blob bundle lacks its attachment target",
    );
  for (const target of targets) {
    const path = input.authorization.containerPathByManifestHash.get(
      target.containerManifestHash,
    );
    const manifest = path?.at(-1);
    if (!manifest)
      throw new ProjectionDependencyUnavailableError(
        "Blob wrapped-target manifest is unavailable",
      );
    if (
      manifest.state.containerId !== target.containerId ||
      manifest.state.containerKeyEpochId !== target.containerKeyEpochId
    ) {
      throw new KeyingVerificationError(
        "object_mismatch",
        "Blob wrapped target differs from verified container history",
      );
    }
  }
}
