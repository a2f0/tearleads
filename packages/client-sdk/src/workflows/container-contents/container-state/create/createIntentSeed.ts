import { encodeVersionVector } from "@tearleads/loro";
import type { PendingUpdateRecord } from "../../../../data/sqlite/documentPersistence";
import { documentCreateSeedCandidate } from "../../../documents/sync/initialSync";
import {
  discardUnacceptedContainerMetadataUpdateIds,
  preRegisterMaterializedContainerMetadataUpdateIds,
} from "../../metadata/metadataSyncRegistrations";
import type { ContainerState } from "../../remoteHydration";
import type { createRemoteContainer } from "../remote";
import type { ContainerCreateIntentSyncState } from "../types";
import { plannedContainerMetadataDocumentId } from "./createWithMetadataPlan";

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

/**
 * Runs a seeded create with the seed's id registered as self-authored first,
 * as a metadata sync registers the ids it sends, so the create's own update
 * echo cannot arm the metadata sync the seed replaces. An id the create did
 * not commit is discarded.
 */
export async function withRegisteredMetadataSeed(
  locallyAcceptedUpdateIds: Set<string> | undefined,
  seed: PendingUpdateRecord | null,
  create: () => ReturnType<typeof createRemoteContainer>,
): ReturnType<typeof createRemoteContainer> {
  const registered: string[] = [];
  if (seed) {
    preRegisterMaterializedContainerMetadataUpdateIds(
      locallyAcceptedUpdateIds,
      registered,
      [seed.id],
    );
  }
  let accepted: string[] = [];
  try {
    const created = await create();
    if (created && typeof created !== "symbol" && created.metadataSeed) {
      accepted = [created.metadataSeed.updateId];
    }
    return created;
  } finally {
    discardUnacceptedContainerMetadataUpdateIds(
      locallyAcceptedUpdateIds,
      registered,
      accepted,
    );
  }
}

/**
 * Runs a folder's create with its planned metadata document id registered, so
 * a peer's metadata hint that arrives before the response installs the id
 * still queues the folder's first read (see
 * `listContainerMetadataDocumentUpdateIds`).
 */
export async function withPlannedMetadataDocumentId<T>(
  plannedDocumentIds: Set<string> | undefined,
  containerId: string,
  create: () => Promise<T>,
): Promise<T> {
  const documentId = plannedContainerMetadataDocumentId(containerId);
  plannedDocumentIds?.add(documentId);
  try {
    return await create();
  } finally {
    plannedDocumentIds?.delete(documentId);
  }
}
