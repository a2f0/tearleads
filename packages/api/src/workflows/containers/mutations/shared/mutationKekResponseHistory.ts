import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import type {
  VerifiedContainerAccessManifest,
  VerifiedContainerKekState,
} from "@tearleads/crypto";
import { createContainerWriterProjectionContext } from "../../writerProjection";
import { loadPredecessorContainerKeks } from "../../writerProjection/predecessorKeks";
import { ContainerWriterProjectionError } from "../../writerProjection/types";
import { ContainerMutationError } from "../errors";
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
  let predecessorKeks: Awaited<ReturnType<typeof loadPredecessorContainerKeks>>;
  try {
    predecessorKeks = await loadPredecessorContainerKeks({
      containerKeyEpochId: kekState.containerKeyEpochId,
      context: createContainerWriterProjectionContext(executor),
    });
  } catch (error) {
    if (error instanceof ContainerWriterProjectionError) {
      throw new ContainerMutationError(error.message, error.status);
    }
    throw error;
  }
  return { containerManifestHistory, predecessorKeks };
}
