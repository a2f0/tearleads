import { encodeVersionVector, exportUpdatesSince } from "@tearleads/loro";
import {
  getDefaultContainerName,
  readContainerMetadataValue,
  writeContainerMetadataValue,
} from "../../data/containers/containerMetadataDocument";
import type { PersistContainerStateResult } from "../../workflows/container-contents/remoteHydration";
import type {
  ContainerContentsStoreSyncAgent,
  ContainerState,
} from "./syncAgent";
import type { ContainerContentsStoreState } from "./types";

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
}): Promise<boolean> {
  const icon = normalizeSystemContainerIcon(input.icon);
  const currentIcon = input.containerState.container.icon ?? null;
  if (currentIcon === icon) {
    return true;
  }

  const metadata = readContainerMetadataValue(
    input.containerState.doc,
    getDefaultContainerName(input.containerState.container.parentId),
  );
  const sourceVersionVector = encodeVersionVector(input.containerState.doc);
  writeContainerMetadataValue(input.containerState.doc, {
    ...metadata,
    icon,
  });
  const update = exportUpdatesSince(
    input.containerState.doc,
    sourceVersionVector,
  );
  const persistenceStatus = await input.persistIcon(
    input.containerState,
    icon,
    update,
  );
  if (persistenceStatus !== "persisted") {
    return false;
  }
  if (input.containerState.record.documentId) {
    input.syncAgent.scheduleSync();
  }
  return true;
}
