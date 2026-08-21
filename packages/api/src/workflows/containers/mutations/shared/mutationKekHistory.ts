import type {
  VerifiedContainerAccessManifest,
  VerifiedContainerKekState,
} from "@symcrypt/crypto";
import type { ContainerWriterProjectionContext } from "../../writerProjection";
import { loadContainerKekManifestHistory } from "../../writerProjection/kek";

// Build the KEK's container manifest history for the mutation response so
// clients can synthesize a self-verifiable writer projection from this mutation
// alone (matching the writer-projection endpoint). A manifest-advancing mutation
// (grant/share, move, revoke) chains its new manifest to the prior one via
// previousManifestHash; without the history the response omits that prior
// bundle, so a later op reusing this container as a parent fails verification
// with "previous manifest <hash> is missing".
export async function loadMutationContainerKekHistory(
  context: ContainerWriterProjectionContext,
  manifest: VerifiedContainerAccessManifest,
  kekState: VerifiedContainerKekState,
): Promise<
  Awaited<ReturnType<typeof loadContainerKekManifestHistory>>["bundles"]
> {
  const history = await loadContainerKekManifestHistory({
    context,
    currentManifest: manifest,
    keyEpoch: kekState.keyEpoch,
    wraps: kekState.wraps,
    // The client already holds the parent path; it only needs this container's
    // own previous-epoch manifest, so skip the ancestry walk in the write txn.
    onlyCurrentContainer: true,
  });
  return history.bundles;
}
