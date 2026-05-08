import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import { exportAllUpdates, importUpdates } from "@tearleads/loro";
import {
  createContainerMetadataDocument,
  getDefaultContainerName,
  readContainerMetadataValue,
  writeContainerMetadataValue,
} from "../../data/containers";
import type { DocumentRecord } from "../../data/sqlite/documentPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import {
  type ExplorerPersistence,
  enqueuePendingExplorerContainerUpdate,
  initializeExplorerSchema,
  loadStoredExplorerContainers,
  type StoredExplorerContainer,
  saveExplorerContainer,
} from "./containerPersistence";
import type { ExplorerContainerState } from "./remoteHydration";

interface ExplorerLocalStateRuntime {
  execSql: ExecSql;
}

function createInitialExplorerContainerRecord(input: {
  container: StoredExplorerContainer["container"];
  loroSnapshot: string;
}): DocumentRecord {
  return {
    accessEpoch: 1,
    accessStateHash: null,
    documentId: input.container.metadataDocumentId,
    id: input.container.id,
    lastCommitLsn: null,
    loroSnapshot: input.loroSnapshot,
    contentKeyBundle: null,
    documentKekTargets: null,
    documentManifestBundle: null,
  };
}

async function hydrateStoredExplorerContainerState(input: {
  execSql: ExecSql;
  persistence: ExplorerPersistence;
  storedContainer: StoredExplorerContainer;
}): Promise<ExplorerContainerState> {
  const { execSql, persistence, storedContainer } = input;
  const { container } = storedContainer;
  const doc = await createContainerMetadataDocument(container.id);
  let nextContainer = container;
  let nextRecord = storedContainer.record;

  if (nextRecord?.loroSnapshot) {
    importUpdates(doc, [base64ToBytes(nextRecord.loroSnapshot)]);
    const metadata = readContainerMetadataValue(
      doc,
      getDefaultContainerName(container.parentId),
    );
    nextContainer = {
      ...container,
      icon: metadata.icon,
      name: metadata.name,
    };
    await saveExplorerContainer(
      execSql,
      persistence,
      nextContainer,
      nextRecord,
    );
  } else {
    writeContainerMetadataValue(doc, {
      icon: container.icon,
      name: container.name,
    });
    const initialUpdate = exportAllUpdates(doc);
    nextRecord = createInitialExplorerContainerRecord({
      container,
      loroSnapshot: bytesToBase64(initialUpdate),
    });
    await saveExplorerContainer(
      execSql,
      persistence,
      nextContainer,
      nextRecord,
    );

    if (!container.metadataDocumentId) {
      await enqueuePendingExplorerContainerUpdate(execSql, persistence, {
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

export async function loadLocalExplorerContainerStates(input: {
  persistence: ExplorerPersistence;
  runtime: ExplorerLocalStateRuntime;
}): Promise<ReadonlyArray<ExplorerContainerState>> {
  const { persistence, runtime } = input;
  await initializeExplorerSchema(runtime.execSql, persistence);
  const storedContainers = await loadStoredExplorerContainers(
    runtime.execSql,
    persistence,
  );

  const containerStates: ExplorerContainerState[] = [];
  for (const storedContainer of storedContainers) {
    containerStates.push(
      await hydrateStoredExplorerContainerState({
        execSql: runtime.execSql,
        persistence,
        storedContainer,
      }),
    );
  }

  return containerStates;
}
