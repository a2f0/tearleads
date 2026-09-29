import type { AccessManifestCheckpoint } from "@tearleads/crypto";
import {
  assertHeldContainerBinding,
  heldContainerBinding,
} from "../../../data/containers/containerBinding";
import {
  createContainerMetadataDocument,
  getDefaultContainerName,
} from "../../../data/containers/containerMetadataDocument";
import type { ContainerHydrationTombstone } from "../containerPersistence";
import { materializeStoredContainerStateReadOnly } from "../storedContainerState";
import { addIndexedContainerChild } from "./childIndex";
import { reattachDormantContainerMetadata } from "./reattachMetadata";
import { reconcileLocalOnlyRootContainers } from "./reconciliation";
import {
  applyRemoteContainerTimestamps,
  remoteContainerHydrationSaveOptions,
} from "./remoteContainerTimestamps";
import type {
  ContainerChildIndex,
  ContainerState,
  RemoteContainer,
  RemoteContainerHydrationHost,
  RemoteContainerHydrationState,
} from "./types";

interface InsertRemoteContainerStateInput {
  childIdsByParentId?: ContainerChildIndex | undefined;
  host: RemoteContainerHydrationHost;
  expectedHydrationTombstone: ContainerHydrationTombstone | null;
  expectedPlacementCheckpoint?: AccessManifestCheckpoint | undefined;
  isCurrent?: (() => boolean) | undefined;
  remoteContainer: RemoteContainer;
  state: RemoteContainerHydrationState;
}

function createInsertedRemoteContainerState(input: {
  doc: ContainerState["doc"];
  dormantRecord: Awaited<
    ReturnType<
      RemoteContainerHydrationState["persistence"]["loadContainerMetadataRecord"]
    >
  >;
  remoteContainer: RemoteContainer;
}): ContainerState {
  const { doc, dormantRecord, remoteContainer } = input;
  const reattached = reattachDormantContainerMetadata({
    defaultName: getDefaultContainerName(remoteContainer.parentId),
    doc,
    dormantRecord,
    remoteMetadataDocumentId: remoteContainer.metadataDocumentId,
  });
  return {
    container: applyRemoteContainerTimestamps(
      {
        id: remoteContainer.id,
        effectiveAccessLevel: remoteContainer.effectiveAccessLevel,
        organizationId: remoteContainer.organizationId,
        parentId: remoteContainer.parentId,
        metadataDocumentId: remoteContainer.metadataDocumentId,
        systemSlot: remoteContainer.systemSlot ?? null,
        name: reattached.name,
        icon: reattached.icon,
      },
      remoteContainer,
    ),
    metadataReferencedPrincipals: remoteContainer.metadataReferencedPrincipals,
    doc,
    record: {
      accessEpoch: remoteContainer.metadataAccessEpoch,
      accessStateHash: remoteContainer.metadataAccessStateHash,
      documentId: remoteContainer.metadataDocumentId,
      id: remoteContainer.id,
      lastCommitLsn: reattached.lastCommitLsn,
      metadataUpdates: reattached.initialSnapshot,
      ...(reattached.pullContinuation === undefined
        ? {}
        : { pullContinuation: reattached.pullContinuation }),
      ...(reattached.pullContinuationRecoveryRequired
        ? { pullContinuationRecoveryRequired: true as const }
        : {}),
      snapshotEndVersion: reattached.snapshotEndVersion,
      contentKeyBundle: null,
      documentKekTargets: null,
      documentManifestBundle: null,
    },
  };
}

/**
 * Insert a verified container the device holds no live row for, re-attaching
 * retained dormant metadata whose binding matches.
 */
export async function insertRemoteContainerState(
  input: InsertRemoteContainerStateInput,
): Promise<ContainerState | null> {
  const { childIdsByParentId, host, remoteContainer, state } = input;
  const execSql = state.runtime.infra.execSql;
  const persistence = state.persistence;
  const doc = await createContainerMetadataDocument(remoteContainer.id);
  if (input.isCurrent?.() === false) {
    return null;
  }
  // A container inserted with dormant retained metadata (row 4's
  // access_revoked branch) is a re-attach, not a fresh discovery: import the
  // retained content and markers instead of overwriting them with an empty
  // document. Access and keying fields still come from the remote container —
  // revocation may have rotated them.
  const dormantRecord = await persistence.loadContainerMetadataRecord(
    execSql,
    remoteContainer.id,
  );
  if (input.isCurrent?.() === false) {
    return null;
  }
  // Destination verification refused a relisting that conflicts with the
  // retained organization or metadata target. A record committed since then
  // by a concurrent hydration is refused here; commit rechecks both durably.
  assertHeldContainerBinding(
    {
      organizationId: "",
      metadataDocumentId: dormantRecord?.documentId ?? null,
    },
    {
      organizationId: remoteContainer.organizationId,
      metadataDocumentIds: [remoteContainer.metadataDocumentId],
    },
  );
  const containerState = createInsertedRemoteContainerState({
    doc,
    dormantRecord,
    remoteContainer,
  });

  const committed = await persistence.commitHydratedContainer(execSql, {
    container: containerState.container,
    expectedDormantRecord: dormantRecord,
    expectedHydrationTombstone: input.expectedHydrationTombstone,
    expectedPlacementCheckpoint: input.expectedPlacementCheckpoint,
    record: containerState.record,
    remoteUpdatedAt: remoteContainer.updatedAt,
    saveOptions: remoteContainerHydrationSaveOptions({ remoteContainer }),
    stillCurrent: input.isCurrent,
  });
  let installedState = containerState;
  if (committed.committed) {
    installedState.container = committed.container;
  } else {
    const winningStoredState = await persistence.loadContainerMetadataState(
      execSql,
      remoteContainer.id,
    );
    if (!winningStoredState) return null;
    // A concurrent hydration that won the insert holds the binding now.
    assertHeldContainerBinding(heldContainerBinding(winningStoredState), {
      organizationId: remoteContainer.organizationId,
      metadataDocumentIds: [remoteContainer.metadataDocumentId],
    });
    const winningState = await materializeStoredContainerStateReadOnly({
      storedContainer: winningStoredState,
    });
    if (
      !winningState ||
      !(await persistence.containerExists(execSql, remoteContainer.id))
    ) {
      return null;
    }
    installedState = winningState;
    installedState.metadataReferencedPrincipals =
      remoteContainer.metadataReferencedPrincipals;
  }
  if (input.isCurrent?.() === false) {
    return null;
  }
  state.containersById.set(remoteContainer.id, installedState);
  if (childIdsByParentId) {
    addIndexedContainerChild(
      childIdsByParentId,
      remoteContainer.id,
      installedState.container.parentId,
    );
  }
  await reconcileLocalOnlyRootContainers({
    childIdsByParentId,
    isCurrent: input.isCurrent,
    remoteRootState: installedState,
    requestDocumentPriming: host.requestDocumentPriming,
    state,
  });
  return installedState;
}
