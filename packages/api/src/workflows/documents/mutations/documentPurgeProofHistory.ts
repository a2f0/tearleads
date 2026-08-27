import type { AccessManifestBundleWireResponse } from "@symcrypt/validators/response";
import { DocumentMutationError } from "./errors";

export function selectDocumentManifestPredecessors(input: {
  readonly checkpointManifestHash?: string | undefined;
  readonly head: AccessManifestBundleWireResponse;
  readonly history: readonly AccessManifestBundleWireResponse[];
}): AccessManifestBundleWireResponse[] {
  if (
    input.checkpointManifestHash === undefined ||
    input.checkpointManifestHash === input.head.manifestHash
  ) {
    return [];
  }
  const checkpointIndex = input.history.findIndex(
    (bundle) => bundle.manifestHash === input.checkpointManifestHash,
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
