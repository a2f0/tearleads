import type {
  VerifiedContainerParentEdge,
  VerifyContainerParentEdgeInput,
} from "./containerAccessTypes";
import { makeVerifiedContainerParentEdge } from "./containerAccessTypes";
import { ok, throwVerification, toVerificationResult } from "./shared";
import type { KeyingVerificationResult } from "./verificationError";

export function verifyContainerParentEdge({
  child,
  parentHistory,
}: VerifyContainerParentEdgeInput): KeyingVerificationResult<VerifiedContainerParentEdge> {
  try {
    if (!child.state.parentContainerId || !child.state.parentManifestHash) {
      throwVerification(
        "missing_dependency",
        "container parent edge requires a parent manifest hash",
      );
    }

    if (parentHistory.length === 0) {
      throwVerification(
        "missing_dependency",
        "container parent edge requires parent manifest history",
      );
    }

    for (const parentManifest of parentHistory) {
      if (parentManifest.state.containerId !== child.state.parentContainerId) {
        throwVerification(
          "object_mismatch",
          "container parent edge history contains the wrong parent container",
        );
      }
    }

    if (
      !parentHistory.some(
        (parentManifest) =>
          parentManifest.manifestHash === child.state.parentManifestHash,
      )
    ) {
      throwVerification(
        "missing_dependency",
        "container parent manifest hash is not present in parent history",
      );
    }

    return ok(
      makeVerifiedContainerParentEdge({
        childContainerId: child.state.containerId,
        childManifestHash: child.manifestHash,
        parentContainerId: child.state.parentContainerId,
        parentManifestHash: child.state.parentManifestHash,
      }),
    );
  } catch (error) {
    return toVerificationResult(error);
  }
}
