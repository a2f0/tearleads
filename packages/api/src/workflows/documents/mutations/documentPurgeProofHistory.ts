import type { AccessManifestBundleWireResponse } from "@tearleads/validators/response";
import { DocumentMutationError } from "./errors";

export function selectDocumentManifestPredecessors(input: {
  /** Exact hash already authorized from durable caller-observation state. */
  readonly authorizedCheckpointManifestHash?: string | undefined;
  readonly head: AccessManifestBundleWireResponse;
  readonly history: readonly AccessManifestBundleWireResponse[];
}): AccessManifestBundleWireResponse[] {
  if (
    input.authorizedCheckpointManifestHash === undefined ||
    input.authorizedCheckpointManifestHash === input.head.manifestHash
  ) {
    return [];
  }
  const checkpointIndex = input.history.findIndex(
    (bundle) => bundle.manifestHash === input.authorizedCheckpointManifestHash,
  );
  if (checkpointIndex < 0) {
    throw new DocumentMutationError(
      "Document purge checkpoint does not belong to the retained document chain",
      409,
    );
  }
  return input.history.slice(0, checkpointIndex + 1);
}

export function uniquePurgeProofBundles(
  bundles: readonly AccessManifestBundleWireResponse[],
): AccessManifestBundleWireResponse[] {
  return [
    ...new Map(bundles.map((bundle) => [bundle.manifestHash, bundle])).values(),
  ];
}
