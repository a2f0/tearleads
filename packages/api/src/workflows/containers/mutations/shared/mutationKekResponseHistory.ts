import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import type {
  VerifiedContainerAccessManifest,
  VerifiedContainerKekState,
} from "@tearleads/crypto";
import { createContainerWriterProjectionContext } from "../../writerProjection";
import { loadPredecessorContainerKeks } from "../../writerProjection/predecessorKeks";
import { loadMutationContainerKekHistory } from "./mutationKekHistory";

export async function loadMutationKekResponseHistory(
  executor: DatabaseTransaction,
  manifest: VerifiedContainerAccessManifest,
  kekState: VerifiedContainerKekState,
) {
  const containerManifestHistory = await loadMutationContainerKekHistory(
    executor,
    manifest,
    kekState,
  );
  const predecessorKeks = await loadPredecessorContainerKeks({
    containerKeyEpochId: kekState.containerKeyEpochId,
    context: createContainerWriterProjectionContext(executor),
  });
  return { containerManifestHistory, predecessorKeks };
}
