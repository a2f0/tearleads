import { encodeVersionVector, exportUpdatesSince } from "@symcrypt/loro";
import {
  getDefaultContainerName,
  readContainerMetadataValue,
  writeContainerMetadataValue,
} from "../../data/containers/containerMetadataDocument";
import { enqueuePendingContainerUpdate } from "../../workflows/container-contents/containerPersistence";
import type {
  ContainerContentsStoreSyncAgent,
  ContainerState,
} from "./syncAgent";
import type { ContainerContentsStoreState } from "./types";

type PersistSystemContainerIcon = (
  containerState: ContainerState,
  icon: string | null,
) => Promise<void>;

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
}): Promise<void> {
  const icon = normalizeSystemContainerIcon(input.icon);
  const currentIcon = input.containerState.container.icon ?? null;
  if (currentIcon === icon) {
    return;
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
  if (input.containerState.record.documentId) {
    await enqueuePendingContainerUpdate(
      input.state.runtime.infra.execSql,
      input.state.persistence,
      {
        containerId: input.containerState.container.id,
        sourceVersionVector,
        update,
      },
    );
  }
  await input.persistIcon(input.containerState, icon);
  if (input.containerState.record.documentId) {
    input.syncAgent.scheduleSync();
  }
}
