import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import type {
  VerifiedContainerAccessManifest,
  VerifiedContainerKekState,
} from "@tearleads/crypto";
import type { PredecessorContainerKekResponse } from "@tearleads/validators/response";
import { createContainerWriterProjectionContext } from "../../writerProjection";
import { loadPredecessorContainerKeks } from "../../writerProjection/predecessorKeks";
import { ContainerWriterProjectionError } from "../../writerProjection/types";
import { ContainerMutationError } from "../errors";
import { loadMutationContainerKekHistory } from "./mutationKekHistory";

interface MutationKekResponseHistory {
  readonly containerManifestHistory: Awaited<
    ReturnType<typeof loadMutationContainerKekHistory>
  >;
  readonly predecessorKeks: PredecessorContainerKekResponse[];
}

export async function loadMutationKekResponseHistory(
  executor: DatabaseTransaction,
  manifest: VerifiedContainerAccessManifest,
  kekState: VerifiedContainerKekState,
): Promise<MutationKekResponseHistory> {
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
