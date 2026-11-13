import { canWriteEffectiveAccessLevel } from "../../../data/keying/accessLevel";
import { createContainerDocumentQueriesFromRuntime } from "../../../workflows/container-contents/documentQueries";
import {
  installContainerMetadataRecord,
  writeContainerMetadataPatch,
} from "../../../workflows/container-contents/metadata/metadataPersistence";
import {
  createDetachedContainerMetadataState,
  installDetachedContainerMetadataState,
} from "../../../workflows/container-contents/metadata/metadataStateIsolation";
import type { ContainerWriteGuard } from "../remoteWrites/writeGeneration";
import { updateContainerContentsSnapshot } from "../state";
import type { ContainerContentsStoreSyncAgent } from "../syncAgent";
import type { ContainerContentsStoreState } from "../types";
import { toContainerNode } from "../utils";

export async function setContainerPrimaryDocument(
  state: ContainerContentsStoreState,
  syncAgent: ContainerContentsStoreSyncAgent,
  containerId: string,
  documentId: string | null,
  isCurrent: ContainerWriteGuard,
) {
  const live = state.containersById.get(containerId);
  if (
    !live ||
    state.runtime.infra.dbStatus !== "ready" ||
    !state.snapshot.ready
  )
    return null;
  if (!canWriteEffectiveAccessLevel(live.container.effectiveAccessLevel))
    return null;
  const current = () =>
    isCurrent() && state.containersById.get(containerId) === live;
  if (
    documentId !== null &&
    !(await createContainerDocumentQueriesFromRuntime(
      state.runtime,
    ).loadContainerDocumentSummary({ containerId, documentId }))
  )
    return null;
  if (!current()) return null;
  const candidate = await createDetachedContainerMetadataState(live);
  if (!current()) return null;
  const saved = await writeContainerMetadataPatch({
    execSql: state.runtime.infra.execSql,
    metadataState: candidate,
    patch: { primaryDocumentId: documentId },
    persistence: state.persistence,
    stillCurrent: current,
  });
  if (
    !saved ||
    !current() ||
    saved.syncIdentitySuperseded ||
    saved.mutationSuperseded
  )
    return null;
  candidate.container = saved.container;
  installContainerMetadataRecord(candidate, saved.record);
  installDetachedContainerMetadataState(live, candidate);
  updateContainerContentsSnapshot(state);
  syncAgent.scheduleSync();
  return toContainerNode(live);
}
