import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import { exportAllUpdates, importUpdates } from "@tearleads/loro";
import {
  createContainerMetadataDocument,
  getDefaultContainerName,
  readContainerMetadataValue,
  writeContainerMetadataValue,
} from "../../data/containers/containerMetadataDocument";
import type { DocumentRecord } from "../../data/sqlite/documentPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import {
  type ContainerContentsPersistence,
  enqueuePendingContainerUpdate,
  initializeContainerContentsSchema,
  loadStoredContainerStates,
  type StoredContainerState,
  saveContainer,
} from "./containerPersistence";
import type { ContainerState } from "./remoteHydration";
import {
  type ContainerContentsWorkflowSqlRuntime,
  getContainerContentsWorkflowRuntimeExecSql,
} from "./runtime";

type LocalContainerStateRuntime = ContainerContentsWorkflowSqlRuntime;

function createInitialContainerContentsContainerRecord(input: {
  container: StoredContainerState["container"];
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
    await saveContainer(execSql, persistence, nextContainer, nextRecord);
  } else {
    writeContainerMetadataValue(doc, {
      icon: container.icon,
      name: container.name,
    });
    const initialUpdate = exportAllUpdates(doc);
    nextRecord = createInitialContainerContentsContainerRecord({
      container,
      loroSnapshot: bytesToBase64(initialUpdate),
    });
    await saveContainer(execSql, persistence, nextContainer, nextRecord);

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
  const execSql = getContainerContentsWorkflowRuntimeExecSql(runtime);
  await initializeContainerContentsSchema(execSql, persistence);
  const storedContainers = await loadStoredContainerStates(
    execSql,
    persistence,
  );

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
