import { encodeVersionVector } from "@tearleads/loro";
import { documentCreateSeedCandidate } from "../../../documents/sync/initialSync";
import type { ContainerState } from "../../remoteHydration";
import type { ContainerCreateIntentSyncState } from "../types";

/**
 * The queued first metadata update, when it holds the whole document, commits
 * with the create instead of a following metadata sync. A seed only saves that
 * sync, so a queue that cannot be read means no seed rather than a failed pass.
 */
export async function loadMetadataSeedUpdate(
  state: ContainerCreateIntentSyncState,
  containerState: ContainerState,
) {
  try {
    return documentCreateSeedCandidate({
      documentVersion: encodeVersionVector(containerState.doc),
      pendingUpdates: await state.persistence.listPendingUpdates(
        state.runtime.infra.execSql,
        containerState.container.id,
      ),
    });
  } catch {
    return null;
  }
}
