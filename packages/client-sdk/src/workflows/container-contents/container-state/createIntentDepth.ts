import { CONTAINER_PATH_TOO_DEEP_MESSAGE } from "../../../data/containers/shared/containerPathLimits";
import { localChildPathFits } from "./localPathDepth";
import type { ContainerCreateIntentSyncInput } from "./types";

/**
 * A create whose path is already too deep here can never succeed, so waiting
 * costs no request; a local move of the folder re-arms the intent. A stale
 * local view the server still refuses keeps retrying like other permanent
 * server refusals. Returns whether the create was deferred.
 */
export async function deferTooDeepCreate(
  input: ContainerCreateIntentSyncInput,
): Promise<boolean> {
  const { intent, state } = input;
  if (localChildPathFits(state.containersById, intent.parentContainerId)) {
    return false;
  }
  if (intent.lastError !== CONTAINER_PATH_TOO_DEEP_MESSAGE) {
    await state.persistence.recordCreateIntentRevisionError(
      state.runtime.infra.execSql,
      {
        containerId: intent.containerId,
        expectedIntentId: intent.id,
        expectedUpdatedAt: intent.updatedAt,
        message: CONTAINER_PATH_TOO_DEEP_MESSAGE,
        stillCurrent: input.isCurrent,
      },
    );
  }
  return true;
}
