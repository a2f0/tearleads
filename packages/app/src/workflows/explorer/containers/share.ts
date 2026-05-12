import type { ProjectionUserKeyResolver } from "../../../data/keyingProjectionVerification";
import type { ExplorerPersistence } from "../containerPersistence";
import { persistExplorerContainerMetadataStateFromRuntime } from "../metadata";
import type { ExplorerContainerState } from "../remoteHydration";
import { shareRemoteExplorerContainer } from "./remote";
import type {
  ExplorerContainerWorkflowRuntime,
  SharedExplorerContainerState,
} from "./types";

export async function shareExplorerContainerState(input: {
  accessLevel: "read" | "write" | "admin";
  containerState: ExplorerContainerState;
  persistence: ExplorerPersistence;
  recipientUserId: string;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ExplorerContainerWorkflowRuntime;
}): Promise<SharedExplorerContainerState | null> {
  const shared = await shareRemoteExplorerContainer({
    accessLevel: input.accessLevel,
    containerId: input.containerState.container.id,
    recipientUserId: input.recipientUserId,
    resolveProjectionUserKey: input.resolveProjectionUserKey,
    runtime: input.runtime,
  });

  if (!shared) {
    return null;
  }

  await input.runtime.cacheReferencedPrincipalPolicies(
    shared.referencedPrincipalHeads,
  );

  const persisted = await persistExplorerContainerMetadataStateFromRuntime({
    metadataState: input.containerState,
    patch: {
      accessEpoch: shared.accessEpoch,
      accessStateHash: shared.accessManifestHash,
      documentId: shared.metadataDocumentId,
      metadataDocumentId: shared.metadataDocumentId,
      contentKeyBundle: null,
      documentKekTargets: null,
      documentManifestBundle: null,
    },
    persistence: input.persistence,
    runtime: input.runtime,
  });

  return {
    container: persisted.container,
    record: persisted.record,
  };
}
