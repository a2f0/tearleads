import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import { exportAllUpdates, importUpdates } from "@tearleads/loro";
import {
  createContainerMetadataDocument,
  getDefaultContainerName,
  readContainerMetadataValue,
  writeContainerMetadataValue,
} from "../../data/containers/containerMetadataDocument";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import {
  type ContainerContentsPersistence,
  type ContainerMetadataRecord,
  enqueuePendingContainerUpdate,
  type StoredContainerState,
} from "./containerPersistence";
import type { ContainerState } from "./remoteHydration";
import type { ContainerContentsWorkflowSqlRuntime } from "./runtime";

type LocalContainerStateRuntime = ContainerContentsWorkflowSqlRuntime;
type SaveContainerOptions = Parameters<
  ContainerContentsPersistence["saveContainer"]
>[3];

function createInitialContainerContentsContainerRecord(input: {
  container: StoredContainerState["container"];
  metadataUpdates: string;
}): ContainerMetadataRecord {
  return {
    accessEpoch: 1,
    accessStateHash: null,
    documentId: input.container.metadataDocumentId,
    id: input.container.id,
    lastCommitLsn: null,
    metadataUpdates: input.metadataUpdates,
    snapshotEndVersion: "",
    contentKeyBundle: null,
    documentKekTargets: null,
    documentManifestBundle: null,
  };
}

function hasContainerMetadataProjectionChanged(
  left: StoredContainerState["container"],
  right: StoredContainerState["container"],
): boolean {
  return left.icon !== right.icon || left.name !== right.name;
}

function createMetadataSnapshotReplaySaveOptions(
  container: StoredContainerState["container"],
): SaveContainerOptions {
  const localUpdatedAt =
    container.localUpdatedAt ?? container.updatedAt ?? null;
  return localUpdatedAt ? { localUpdatedAt } : undefined;
}

async function hydrateStoredContainerStateState(input: {
  execSql: ExecSql;
  persistence: ContainerContentsPersistence;
  storedContainer: StoredContainerState;
}): Promise<ContainerState> {
  const { execSql, persistence, storedContainer } = input;
  const { container } = storedContainer;
  const doc = await createContainerMetadataDocument(container.id);
  let nextContainer = container;
  let nextRecord = storedContainer.record;

  if (nextRecord?.metadataUpdates) {
    importUpdates(doc, [base64ToBytes(nextRecord.metadataUpdates)]);
    const metadata = readContainerMetadataValue(
      doc,
      getDefaultContainerName(container.parentId),
    );
    nextContainer = {
      ...container,
      icon: metadata.icon,
      name: metadata.name,
    };
    if (hasContainerMetadataProjectionChanged(container, nextContainer)) {
      await persistence.saveContainer(
        execSql,
        nextContainer,
        nextRecord,
        createMetadataSnapshotReplaySaveOptions(container),
      );
    }
  } else {
    writeContainerMetadataValue(doc, {
      icon: container.icon,
      name: container.name,
    });
    const initialUpdate = exportAllUpdates(doc);
    nextRecord = createInitialContainerContentsContainerRecord({
      container,
      metadataUpdates: bytesToBase64(initialUpdate),
    });
    await persistence.saveContainer(execSql, nextContainer, nextRecord);

    if (!container.metadataDocumentId) {
      await enqueuePendingContainerUpdate(execSql, persistence, {
        containerId: container.id,
        update: initialUpdate,
      });
    }
  }

  return {
    container: nextContainer,
    doc,
    record: nextRecord,
  };
}

export async function loadLocalContainerStates(input: {
  persistence: ContainerContentsPersistence;
  runtime: LocalContainerStateRuntime;
}): Promise<ReadonlyArray<ContainerState>> {
  const { persistence, runtime } = input;
  const execSql = runtime.infra.execSql;
  await persistence.ensureSchema(execSql);
  const storedContainers = await persistence.loadContainers(execSql);

  const containerStates: ContainerState[] = [];
  for (const storedContainer of storedContainers) {
    containerStates.push(
      await hydrateStoredContainerStateState({
        execSql,
        persistence,
        storedContainer,
      }),
    );
  }

  return containerStates;
}
