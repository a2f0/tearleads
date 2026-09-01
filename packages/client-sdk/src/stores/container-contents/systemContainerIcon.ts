import { encodeVersionVector, exportUpdatesSince } from "@tearleads/loro";
import {
  getDefaultContainerName,
  readContainerMetadataValue,
  writeContainerMetadataValue,
} from "../../data/containers/containerMetadataDocument";
import {
  createDetachedContainerMetadataState,
  installDetachedContainerMetadataState,
} from "../../workflows/container-contents/metadataStateIsolation";
import type { PersistContainerStateResult } from "../../workflows/container-contents/remoteHydration";
import { removeMissingContainerState } from "./missingContainerState";
import { updateContainerContentsSnapshot } from "./state";
import type {
  ContainerContentsStoreSyncAgent,
  ContainerState,
} from "./syncAgent";
import type { ContainerContentsStoreState } from "./types";
import type { ContainerWriteGuard } from "./writeGeneration";

type PersistSystemContainerIcon = (
  containerState: ContainerState,
  icon: string | null,
  update: Uint8Array,
) => Promise<PersistContainerStateResult["status"]>;

function normalizeSystemContainerIcon(
  icon: string | null | undefined,
): string | null {
  return icon?.trim() || null;
}

export async function applySystemContainerIcon(input: {
  readonly containerState: ContainerState;
  readonly icon: string | null | undefined;
  readonly persistIcon: PersistSystemContainerIcon;
  readonly state: ContainerContentsStoreState;
  readonly syncAgent: ContainerContentsStoreSyncAgent;
  readonly isCurrent?: ContainerWriteGuard | undefined;
}): Promise<boolean> {
  const isCurrent = input.isCurrent ?? (() => true);
  const icon = normalizeSystemContainerIcon(input.icon);
  const currentIcon = input.containerState.container.icon ?? null;
  if (currentIcon === icon) {
    return true;
  }

  if (!isCurrent()) return false;
  const persistenceCandidate = await createDetachedContainerMetadataState(
    input.containerState,
  );
  if (!isCurrent()) return false;
  const metadata = readContainerMetadataValue(
    persistenceCandidate.doc,
    getDefaultContainerName(persistenceCandidate.container.parentId),
  );
  const sourceVersionVector = encodeVersionVector(persistenceCandidate.doc);
  writeContainerMetadataValue(persistenceCandidate.doc, {
    ...metadata,
    icon,
  });
  const update = exportUpdatesSince(
    persistenceCandidate.doc,
    sourceVersionVector,
  );
  const persistenceStatus = await input.persistIcon(
    persistenceCandidate,
    icon,
    update,
  );
  if (persistenceStatus === "missing") {
    removeMissingContainerState(input.state, input.containerState);
  }
  if (persistenceStatus !== "persisted" || !isCurrent()) {
    return false;
  }
  installDetachedContainerMetadataState(
    input.containerState,
    persistenceCandidate,
    { preserveConcurrentMetadataEdit: true },
  );
  updateContainerContentsSnapshot(input.state);
  if (input.containerState.record.documentId) {
    input.syncAgent.scheduleSync();
  }
  return true;
}
